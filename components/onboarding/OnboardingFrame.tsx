'use client';

import { usePathname } from 'next/navigation';

/**
 * Chrome shared by the three onboarding steps.
 *
 * The step is derived from the pathname rather than held in state, because the
 * steps are now separate routes — the URL is the source of truth, so a refresh,
 * a back button or a deep link all show the right progress without anything
 * needing to be restored.
 */
const STEPS = ['/onboarding/profile', '/onboarding/avatar', '/onboarding/taste'] as const;
const LABELS = ['Profile', 'Photo', 'Taste'] as const;

export function OnboardingFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const index = STEPS.findIndex((s) => pathname.startsWith(s));
  const current = index === -1 ? 0 : index;
  const progress = Math.round(((current + 1) / STEPS.length) * 100);

  return (
    <div className="onb">
      {/* These class names are load-bearing and must match globals.css exactly:
          `.onb-progress i` is the fill, `.onb-bar` is the header row, and
          `.onb-viewport` is the flex container that centres the step. Invent a
          name here and the step renders jammed against the left edge. */}
      <div
        className="onb-progress"
        role="progressbar"
        aria-valuenow={current + 1}
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-label={`Step ${current + 1} of ${STEPS.length}: ${LABELS[current]}`}
      >
        <i style={{ width: `${progress}%` }} />
      </div>

      <div className="onb-bar">
        <span className="onb-step-label">
          Step {current + 1} of {STEPS.length}
        </span>
      </div>

      <div className="onb-viewport">
        <div className="onb-step">{children}</div>
      </div>
    </div>
  );
}
