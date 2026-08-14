import { Suspense } from 'react';

import { VerifyGate } from '@/components/auth/VerifyGate';
import { AdvisorScreen } from '@/components/ai/AdvisorScreen';

export const metadata = {
  title: 'AI Advisor — Velvet',
  description: 'Your personal film and entertainment advisor.',
};

/**
 * The AI Advisor: Velvet's social and interactive heart.
 *
 * Suspense wraps it because the screen reads `?q=` — the detail page's "Ask AI"
 * button lands here with the question pre-filled.
 */
export default function AiPage() {
  return (
    <Suspense fallback={null}>
      <VerifyGate feature="the advisor">
        <AdvisorScreen />
      </VerifyGate>
    </Suspense>
  );
}
