'use client';

import { useState } from 'react';

import { Trash } from '@/components/icons';
import { DELETE_WINDOW_MS, type DeleteScope } from '@/lib/messages';

import { MenuSurface } from './MenuSurface';

/**
 * The thread header's ⋯ menu: conversation-level clearing.
 *
 * Both entries are bulk applications of the per-message rules, not new kinds
 * of deletion — which is precisely what the copy has to convey, because the
 * two outcomes are wildly asymmetric and only one of them looks like "clear
 * the chat" afterwards:
 *
 *  - **Clear chat for me** hides every message from this viewer. The other
 *    person's thread is untouched and they are told nothing.
 *  - **Delete my recent messages** retracts only what *I* sent, and only
 *    inside the delete window. It leaves their half of the conversation, and
 *    my older half, exactly where they were.
 *
 * The second is deliberately not called "clear for everyone". A label that
 * promises an empty thread and delivers a partially-thinned one is a broken
 * promise no amount of explanatory copy underneath can rescue — and the user
 * discovers it after the irreversible step, which is the worst possible
 * moment. The name states the outcome; the note states the limits.
 */

/** "48 hours", derived rather than typed, so it cannot drift from the rule. */
const WINDOW_LABEL = `${Math.round(DELETE_WINDOW_MS / 3_600_000)} hours`;

type Stage = 'menu' | DeleteScope;

export function ThreadMenu({
  otherName,
  anchor,
  busy,
  onClear,
  onClose,
}: {
  otherName: string | undefined;
  anchor: { x: number; y: number } | null;
  /** A clear already in flight. Both buttons freeze rather than queueing. */
  busy: boolean;
  onClear: (scope: DeleteScope) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>('menu');
  const them = otherName ?? 'They';

  return (
    <MenuSurface anchor={anchor} label="Conversation actions" onClose={onClose}>
      {stage === 'menu' && (
        <>
          <button type="button" role="menuitem" onClick={() => setStage('me')}>
            <Trash /> Clear chat for me
          </button>
          <button type="button" role="menuitem" onClick={() => setStage('everyone')}>
            <Trash /> Delete my recent messages
          </button>
        </>
      )}

      {stage === 'me' && (
        <>
          <p className="msg-sheet-title">Clear this chat for you?</p>
          <p className="msg-sheet-note">
            Every message disappears from your side only. {them} keeps the whole conversation,
            and anything sent next still arrives here.
          </p>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={busy}
            onClick={() => onClear('me')}
          >
            Clear for me
          </button>
          <button type="button" role="menuitem" className="msg-sheet-cancel" onClick={onClose}>
            Cancel
          </button>
        </>
      )}

      {stage === 'everyone' && (
        <>
          <p className="msg-sheet-title">Delete my recent messages?</p>
          <p className="msg-sheet-note">
            Retracts the messages <strong>you</strong> sent in the last {WINDOW_LABEL}, for both
            of you. Anything older, and everything {them} sent, stays where it is. This cannot be
            undone.
          </p>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={busy}
            onClick={() => onClear('everyone')}
          >
            Delete them
          </button>
          <button type="button" role="menuitem" className="msg-sheet-cancel" onClick={onClose}>
            Cancel
          </button>
        </>
      )}
    </MenuSurface>
  );
}
