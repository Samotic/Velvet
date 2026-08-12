'use client';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Inbox } from '@/components/messages/Inbox';
import { Thread } from '@/components/messages/Thread';

/**
 * A conversation with one person.
 *
 * Both panes render on desktop; below `md` the shell's `.on-thread` class hides
 * the inbox so the thread is the whole screen and Back returns to the list.
 */
export default function ConversationPage({ params }: { params: { userId: string } }) {
  return (
    <ProtectedRoute>
      <div className="msg-shell on-thread">
        <Inbox activeUserId={params.userId} />
        <Thread userId={params.userId} />
      </div>
    </ProtectedRoute>
  );
}
