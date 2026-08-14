import { AppShell } from '@/components/AppShell';

/**
 * The authenticated shell: fixed top nav, the content column, bottom nav on
 * phones, and the unverified-email banner.
 *
 * Everything in this group is behind the middleware gate, so this layout can
 * assume a session exists. That assumption is what lets the nav render without
 * a signed-out variant — there isn't one, because a signed-out visitor never
 * reaches these routes.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
