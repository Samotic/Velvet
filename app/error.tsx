'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
      <div className="empty" style={{ width: '100%' }}>
        <div className="empty-ic">⚠</div>
        <div className="empty-title">Something broke</div>
        <div className="empty-text" style={{ marginBottom: 20 }}>
          Couldn&rsquo;t load that. This is usually TMDB rate-limiting or a bad API key.
        </div>
        <button type="button" className="post-btn" style={{ width: 'auto', padding: '13px 28px' }} onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
