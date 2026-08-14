import { OnboardingFrame } from '@/components/onboarding/OnboardingFrame';

/**
 * The frame every onboarding step sits in: progress bar, step counter, and the
 * card the step renders into.
 *
 * A layout rather than a component each step imports, so the chrome does not
 * unmount between steps — the progress bar animates from one step to the next
 * instead of snapping.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <OnboardingFrame>{children}</OnboardingFrame>;
}
