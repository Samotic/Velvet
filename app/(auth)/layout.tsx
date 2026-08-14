/**
 * The auth shell: nothing at all.
 *
 * Sign-in, sign-up, onboarding and the email flows render edge to edge with no
 * navigation, no gutter and no chrome. That is the entire point of splitting the
 * route groups — the nav lives in `(app)/layout.tsx`, so it cannot leak onto a
 * screen belonging to someone who has not signed in yet.
 *
 * Each page owns its own full-height layout (`.auth-screen`, `.onb`).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="auth-main">{children}</main>;
}
