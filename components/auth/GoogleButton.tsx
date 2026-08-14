'use client';

import { googleSignInUrl } from '@/lib/auth';

/**
 * "Continue with Google".
 *
 * A plain anchor, not a button with an onClick: this is a full-page navigation
 * to the API, which owns the OAuth exchange. No popup — popups get blocked, and
 * a redirect works identically on a phone.
 *
 * The button stays visible even when the server has no Google credentials. The
 * API bounces straight back to /signin?error=google_unavailable, which says so
 * in words — better than a button that silently isn't there, and it saves the
 * client needing a config endpoint just to decide whether to render.
 *
 * The mark is Google's own four-colour G, which their branding guidelines
 * require to sit on white or very light grey. It is the one place in Velvet
 * that is not monochrome indigo, and deliberately so — a recoloured Google
 * button reads as a phishing attempt. Everything around it (the radius, the
 * rule, the type) belongs to the system.
 */
export function GoogleButton({
  label = 'Continue with Google',
  next,
}: {
  label?: string;
  /** Where to land after Google returns. Must be an in-app path. */
  next?: string;
}) {
  return (
    <a className="btn-google" href={googleSignInUrl(next)}>
      <GoogleMark />
      {label}
    </a>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/** The "or" rule that separates Google from the email form. */
export function AuthDivider({ label = 'or' }: { label?: string }) {
  return (
    <div className="auth-divider">
      <span>{label}</span>
    </div>
  );
}
