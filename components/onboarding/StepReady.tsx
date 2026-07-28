'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { VelvetMark } from '@/components/icons';
import { RippleButton } from '@/components/ui/Ripple';

/**
 * Step 6 — the pay-off.
 *
 * The mark pulses with a copper glow, then "Enter Velvet" lands on the home
 * screen. The taste profile was already committed at step 4, so this button is
 * navigation, not a save — nothing can fail here.
 */
export function StepReady({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  return (
    <div style={{ textAlign: 'center' }}>
      <div className="ready-mark">
        <VelvetMark size={52} />
      </div>

      <h1 className="onb-title">
        Your Velvet is ready, <em>{displayName}</em>
      </h1>
      <p className="onb-sub">247,000+ films · AI-powered picks just for you</p>

      <div className="onb-actions" style={{ marginTop: 38 }}>
        <RippleButton
          className="btn-fill btn-lg btn-block"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            router.replace('/');
          }}
        >
          {leaving ? <span className="spinner" /> : 'Enter Velvet'}
        </RippleButton>
      </div>
    </div>
  );
}
