'use client';

import Link from 'next/link';

import { RippleButton } from '@/components/ui/Ripple';

/** Step 1 — the wordmark, the tagline, and the way in. */
export function StepWelcome({ onStart }: { onStart: () => void }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="onb-logo">
        VEL<span>VET</span>
      </div>

      <p className="onb-tagline">Cinema. Series. Games. Your world.</p>

      <div className="onb-actions" style={{ marginTop: 44 }}>
        <RippleButton className="btn-fill btn-lg btn-block" onClick={onStart}>
          Get Started
        </RippleButton>

        <p className="onb-alt">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
