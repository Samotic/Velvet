import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
      <div className="empty" style={{ width: '100%' }}>
        <div className="empty-ic">🎬</div>
        <div className="empty-title">Not found</div>
        <div className="empty-text" style={{ marginBottom: 20 }}>
          That film isn&rsquo;t in the catalog.
        </div>
        <Link href="/" className="post-btn" style={{ display: 'inline-block', width: 'auto', padding: '13px 28px', textDecoration: 'none' }}>
          Back to Discover
        </Link>
      </div>
    </div>
  );
}
