'use client';

import Link from 'next/link';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Inbox } from '@/components/messages/Inbox';
import { ChatBubbles } from '@/components/icons';

/**
 * The inbox with no thread selected.
 *
 * On desktop the empty right pane invites a conversation; on phones the shell's
 * CSS shows only the list, so this is the whole screen.
 */
export default function MessagesPage() {
  return (
    <ProtectedRoute>
      <div className="msg-shell">
        <Inbox />

        <div className="msg-thread">
          <div className="empty" style={{ margin: 'auto' }}>
            <div className="empty-art">
              <ChatBubbles />
            </div>
            <div className="empty-title">Start a conversation</div>
            <div className="empty-text">
              Pick someone from the list, or find people whose taste you trust.
            </div>
            <Link href="/search?mode=people" className="btn-fill">
              Find people
            </Link>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
