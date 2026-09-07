'use client';

/**
 * Configured API client for the Velvet backend.
 *
 * - Prefixes every call with NEXT_PUBLIC_API_URL.
 * - Attaches `Authorization: Bearer <token>` when a token is stored.
 * - Unwraps the backend contract: success `{ data }`, error `{ error }`.
 * - On 401 it clears the token and dispatches `velvet:unauthorized`, which the
 *   AuthProvider listens for to log out and redirect to /login.
 *
 * The token lives in localStorage per the spec. That's readable by JS (an XSS
 * trade-off vs. httpOnly cookies) — documented here so it's a known choice.
 *
 * `setToken`/`clearToken` also mirror the session into a cookie, because the
 * middleware gate runs on the server and cannot read localStorage. That mirror
 * is for *routing only* — see lib/sessionCookie.ts. Writing it here rather than
 * at the call sites is deliberate: every path that starts or ends a session
 * already goes through these two functions, so the cookie cannot fall out of
 * step with the token.
 */

import { clearSessionCookies, writeSessionCookie } from './sessionCookie';

const BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

/**
 * Second line of defence, deliberately not a throw.
 *
 * `next.config.mjs` fails the build when this is missing, which is where the
 * mistake should be caught. But a build can be published from a context that
 * check did not run in, and this module ships to the browser — throwing here
 * would replace a broken feature with a blank page for every visitor. So it
 * says so loudly in the console and carries on: an app calling the wrong host
 * is bad, an app that renders nothing at all is worse, and only one of the two
 * leaves a clue in the developer tools.
 */
if (!process.env.NEXT_PUBLIC_API_URL && typeof window !== 'undefined') {
  console.error(
    'NEXT_PUBLIC_API_URL was not set at build time — falling back to ' +
      'http://localhost:4000. Every API call from this page will fail unless ' +
      'you are running the backend locally. Set it in the deployment ' +
      'environment and rebuild.',
  );
}

export const API_BASE = BASE;
export const TOKEN_KEY = 'velvet.auth.token';
export const UNAUTHORIZED_EVENT = 'velvet:unauthorized';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** True when the failure was "backend unreachable" rather than a real status.
 *  Screens use this to show a calm offline state instead of an error card. */
export const isOffline = (err: unknown) => err instanceof ApiError && err.status === 0;

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  // The cookie first: in private mode localStorage can throw, and a session the
  // gate can see is more useful than one only the API calls can see.
  writeSessionCookie(token);
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode / quota — token just won't persist */
  }
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  clearSessionCookies();
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

type FetchOptions = {
  method?: string;
  body?: unknown;
  /** Skip attaching the token — used for register/login and public reads. */
  auth?: boolean;
  signal?: AbortSignal;
};

async function request<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // An aborted request is the caller cancelling (debounced search, unmount) —
    // rethrow so they can ignore it, rather than reporting the server as down.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Network failure / backend down — give a human message, not a raw TypeError.
    throw new ApiError('Cannot reach the server. Is the API running?', 0);
  }

  // A 401 anywhere means the session is dead — tear it down globally. Skipped
  // for calls that opted out of auth: a failed login is a form error, not an
  // expired session, and must not bounce the user to /login mid-typing.
  if (res.status === 401 && auth) {
    clearToken();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* empty / non-JSON body */
  }

  if (!res.ok) {
    const message =
      (payload as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return (payload as { data: T }).data;
}

export const api = {
  get: <T>(path: string, opts?: FetchOptions) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: FetchOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: FetchOptions) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: FetchOptions) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  del: <T>(path: string, opts?: FetchOptions) => request<T>(path, { ...opts, method: 'DELETE' }),
};

/** Reads a File into a `data:` URL. */
function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ApiError('Could not read that file', 0));
    reader.readAsDataURL(file);
  });
}

/**
 * Image upload, for the profile photo.
 *
 * The file is sent as a base64 data URL on a normal JSON body rather than as
 * multipart. It keeps this client on one code path, and lets the API validate
 * the payload with a regex before forwarding a byte to Cloudinary — the server
 * never needs a file-upload middleware.
 *
 * The trade-off is base64's ~33% inflation, which is why the API caps the
 * string and the UI rejects anything over a few megabytes before we get here.
 */
export async function upload<T>(path: string, file: File): Promise<T> {
  const dataUrl = await toDataUrl(file);
  return request<T>(path, { method: 'POST', body: { file: dataUrl } });
}
