'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { api, clearToken, getToken, setToken, UNAUTHORIZED_EVENT } from '@/lib/api';
import type {
  AuthPayload,
  AuthUser,
  LoginInput,
  OnboardingInput,
  ProfileUpdateInput,
  RegisterInput,
} from '@/lib/authTypes';
import { clearRatingCache } from '@/lib/ratings';
import { writeOnboardedCookie } from '@/lib/sessionCookie';
import { closeSocket } from '@/lib/socket';

/** The browser's IANA zone, or undefined — same guard as the advisor's in lib/ai.ts. */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** Persists onboarding steps 3 and 4 and flips `onboardingCompleted`. */
  completeOnboarding: (input: OnboardingInput) => Promise<AuthUser>;
  /** PUT /api/users/me, used by the edit-profile and settings screens. */
  updateProfile: (input: ProfileUpdateInput) => Promise<AuthUser>;
  /** Merges a fresher user object into context without a round trip. */
  setUser: (user: AuthUser) => void;
  /** Re-read the session from the API. */
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** profile → avatar → taste. Mirrors TOTAL_STEPS in middleware.ts. */
const TOTAL_ONBOARDING_STEPS = 3;

/**
 * The onboarding step to advertise to the middleware gate.
 *
 * `||` rather than `??` deliberately. A user document written before
 * `onboardingStep` existed reads back as **0**, not undefined — Mongoose applies
 * the schema default on load. With `??` that 0 would be taken at face value and
 * every pre-existing account, however long onboarded, would be dragged back to
 * step 1 on its next sign-in. Falling through to `onboardingCompleted` treats
 * those accounts as fully done, which they are.
 */
function stepFor(user: AuthUser): number {
  return user.onboardingStep || (user.onboardingCompleted ? TOTAL_ONBOARDING_STEPS : 0);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Routes a half-set-up account is allowed to sit on without being redirected. */
const ONBOARDING_EXEMPT = ['/onboarding', '/signin', '/signup'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * The only way the user object should be set.
   *
   * Writes the routing cookie **synchronously**, before React commits, because
   * every caller navigates immediately afterwards. Left to the effect below, the
   * `router.replace` in the sign-in form would run first, middleware would read
   * a cookie that isn't there yet, conclude the account has done nothing, and
   * redirect a perfectly onboarded user into /onboarding/profile.
   */
  const applyUser = useCallback((next: AuthUser) => {
    writeOnboardedCookie(stepFor(next));
    setUserState(next);
  }, []);

  /** As above, plus the token — used by the two calls that start a session. */
  const applySession = useCallback(
    (token: string, next: AuthUser) => {
      setToken(token);
      applyUser(next);
    },
    [applyUser],
  );

  const checkAuth = useCallback(async () => {
    // No stored token → definitely logged out. Skip the API call entirely:
    // hitting /me here would 401, and the global 401 handler would redirect
    // the still-public pages (search, detail, profiles) to /signin for anonymous
    // visitors. Home is gated deliberately — see app/page.tsx.
    if (!getToken()) {
      setUserState(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const { user: current } = await api.get<{ user: AuthUser }>('/api/auth/me');
      applyUser(current);
    } catch {
      // Token was present but invalid/expired — api.ts already cleared it.
      setUserState(null);
    } finally {
      setIsLoading(false);
    }
  }, [applyUser]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  /**
   * Belt to `applyUser`'s braces: catches any state change that did not go
   * through it. Effects run *after* the commit, so this alone is not enough —
   * see the note on `applyUser`.
   */
  useEffect(() => {
    if (user) writeOnboardedCookie(stepFor(user));
  }, [user]);

  const logout = useCallback(async () => {
    // Tell the server first so it can clear any server-side session state, but
    // never block the local teardown on it — a failed logout call must still
    // log the user out of this browser.
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* already invalid, or offline — the local clear below is what matters */
    }
    clearToken();
    closeSocket();
    // Memoised star badges are this user's; the next one must not inherit them.
    clearRatingCache();
    setUserState(null);
    router.replace('/signin');
  }, [router]);

  // Global 401 (expired/tampered token mid-session) → log out everywhere.
  // A ref keeps the listener stable while always calling the latest logout.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  useEffect(() => {
    const onUnauthorized = () => {
      clearToken();
      closeSocket();
      setUserState(null);
      router.replace('/signin');
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [router]);

  /**
   * A signed-in account that never finished setup is sent back to /onboarding.
   * Without this, refreshing mid-flow would drop the user on a home screen the
   * AI advisor has no taste profile for.
   */
  useEffect(() => {
    if (isLoading || !user) return;
    if (user.onboardingCompleted) return;
    if (ONBOARDING_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
    router.replace('/onboarding');
  }, [isLoading, user, pathname, router]);

  // NOTE: `/api/auth/login` and `/api/auth/register` are **API endpoints**, not
  // page routes. The pages moved to /signin and /signup; these did not.
  const login = useCallback(async (input: LoginInput) => {
    // The zone rides along so the login-alert email states the time on the
    // user's own clock; the API validates it and falls back to UTC.
    const body = { ...input, timeZone: input.timeZone ?? browserTimeZone() };
    const { token, user: current } = await api.post<AuthPayload>('/api/auth/login', body, {
      auth: false,
    });
    applySession(token, current);
    return current;
  }, [applySession]);

  const register = useCallback(async (input: RegisterInput) => {
    const { token, user: current } = await api.post<AuthPayload>('/api/auth/register', input, {
      auth: false,
    });
    applySession(token, current);
    return current;
  }, [applySession]);

  const completeOnboarding = useCallback(async (input: OnboardingInput) => {
    const { user: current } = await api.post<{ user: AuthUser }>(
      '/api/auth/complete-onboarding',
      input,
    );
    applyUser(current);
    return current;
  }, [applyUser]);

  const updateProfile = useCallback(async (input: ProfileUpdateInput) => {
    const { user: current } = await api.put<{ user: AuthUser }>('/api/users/me', input);
    applyUser(current);
    return current;
  }, [applyUser]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
      completeOnboarding,
      updateProfile,
      setUser: applyUser,
      checkAuth,
    }),
    [
      user,
      isLoading,
      login,
      register,
      logout,
      completeOnboarding,
      updateProfile,
      applyUser,
      checkAuth,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
