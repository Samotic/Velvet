/** The two follow notification badges share one person silhouette. */
export function FollowNotificationIcon({ accepted = false }: { accepted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="7" r="3.5" />
      <path d="M2.5 20v-2a6.5 6.5 0 0 1 11-4.7" />
      {accepted ? <path d="m15 17 2.3 2.3L22 14.5" /> : <path d="M18 13v8m-4-4h8" />}
    </svg>
  );
}
