import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { verifySession } from '@/lib/auth/session';

/**
 * The auth gate. Runs before any HTML is sent, so an unauthenticated visitor
 * never sees the app shell — not even for a frame.
 *
 * The client-side `<ProtectedRoute>` still exists and still works; this sits in
 * front of it. The two are complementary: middleware stops the shell rendering
 * at all, ProtectedRoute catches a session that dies *during* a visit.
 *
 * `verifySession` decodes the session cookie without checking its signature —
 * see lib/auth/session.ts for why that is correct here. Nothing is authorised
 * on this decision; the Express API verifies every request independently.
 */

/**
 * Routes reachable with no session.
 *
 * Four of these are not in the original spec and the flow breaks without them:
 *  - /auth/callback   Google returns here carrying the token. Gating it would
 *                     bounce every Google sign-in back to /signin — the token
 *                     has not been stored yet at that moment.
 *  - /verify-email    Opened from an inbox, often in a different browser.
 *  - /forgot-password Reached precisely because you cannot sign in.
 *  - /reset-password  Same, and it is what issues the new session.
 */
const PUBLIC_PATHS = [
  '/signin',
  '/signup',
  '/auth',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/api/auth',
];

const ONBOARDING_PREFIX = '/onboarding';

/** profile → avatar → taste. Only the first is required. */
const TOTAL_STEPS = 3;

const isPublic = (pathname: string) =>
  PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const session = verifySession(req);

  // Signed out → /signin, remembering where they were headed so the form can
  // return them there instead of dumping everyone on the home screen.
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/signin';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Half-set-up account → back into the flow. The step routes decide which of
  // the three to show; this only guarantees they cannot escape it.
  if (!session.onboardingComplete && !pathname.startsWith(ONBOARDING_PREFIX)) {
    const url = req.nextUrl.clone();
    url.pathname = '/onboarding/profile';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Every step done, but poking at onboarding → home.
  //
  // Gated on the *step*, not on `onboardingComplete`. Step 1 flips that flag,
  // so keying on it would slam the door on steps 2 and 3 the moment step 1
  // succeeded — the user would be redirected home mid-flow.
  if (session.onboardingStep >= TOTAL_STEPS && pathname.startsWith(ONBOARDING_PREFIX)) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next's own assets and static files. The negative lookahead
  // keeps the gate off /_next/*, which would otherwise redirect the JS bundle
  // that the /signin page itself needs in order to render.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf)$).*)',
  ],
};
