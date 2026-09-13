'use client';

import { useState } from 'react';

import { Trash } from '@/components/icons';
import { DELETE_WINDOW_MS, type DeleteScope } from '@/lib/messages';

import { MenuSurface } from './MenuSurface';

/**
 * The thread header's ⋯ menu: conversation-level clearing.
 *
 * Three entries, and the copy has to carry the differences, because they are
 * wildly asymmetric and only one of them looks like "clear the chat" from both
 * sides afterwards:
 *
 *  - **Clear chat for me** hides every message from this viewer. The other
 *    person's thread is untouched and they are told nothing.
 *  - **Delete my recent messages** retracts only what *I* sent, and only
 *    inside the delete window. It leaves their half of the conversation, and
 *    my older half, exactly where they were.
 *  - **Clear chat for both of you** reaches into the other person's account,
 *    so it only asks. Nothing changes until they agree, and when they do the
 *    whole chat goes from both sides — theirs and mine, any age, for good.
 *
 * The second is deliberately not called "clear for everyone". A label that
 * promises an empty thread and delivers a partially-thinned one is a broken
 * promise no amount of explanatory copy underneath can rescue — and the user
 * discovers it after the irreversible step, which is the worst possible
 * moment. The name states the outcome; the note states the limits.
 *
 * The third names the other person in its confirm, twice: nobody expects a
 * menu in their own thread to reach someone else's account, and the confirm is
 * the only guard there is.
 */

/** "48 hours", derived rather than typed, so it cannot drift from the rule. */
const WINDOW_LABEL = `${Math.round(DELETE_WINDOW_MS / 3_600_000)} hours`;

/**
 * `both` confirms asking; `accept` confirms agreeing to someone else's
 * request, and is where the banner's "Clear for both" opens the menu.
 */
export type ThreadMenuStage = 'menu' | DeleteScope | 'both' | 'accept';

export function ThreadMenu({
  otherName,
  anchor,
  busy,
  initialStage = 'menu',
  canAskBoth,
  onClear,
  onAskBoth,
  onAcceptBoth,
  onClose,
}: {
  otherName: string | undefined;
  anchor: { x: number; y: number } | null;
  /** A clear already in flight. Every button freezes rather than queueing. */
  busy: boolean;
  initialStage?: ThreadMenuStage;
  /**
   * Whether to offer "Clear chat for both of you". False while a request is
   * pending in either direction: the banner is where that one is answered or
   * withdrawn, and a second could not be made anyway.
   */
  canAskBoth: boolean;
  onClear: (scope: DeleteScope) => void;
  onAskBoth: () => void;
  onAcceptBoth: () => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<ThreadMenuStage>(initialStage);
  const them = otherName ?? 'They';
  const name = otherName ?? 'this person';
  const Name = otherName ?? 'This person';

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
          {canAskBoth && (
            <button type="button" role="menuitem" onClick={() => setStage('both')}>
              <Trash /> Clear chat for both of you
            </button>
          )}
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

      {stage === 'both' && (
        <>
          <p className="msg-sheet-title">Clear the whole chat for you and {name}?</p>
          <p className="msg-sheet-note">
            Every message, yours and theirs, is removed from both accounts. {Name} has to agree
            first.
          </p>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={busy}
            onClick={onAskBoth}
          >
            Ask to clear for both
          </button>
          <button type="button" role="menuitem" className="msg-sheet-cancel" onClick={onClose}>
            Cancel
          </button>
        </>
      )}

      {/*
        The irreversible step lives here, not on the request: asking can be
        withdrawn, agreeing cannot. Messages sent after the request stay,
        because the clear covers what existed when it was made.
      */}
      {stage === 'accept' && (
        <>
          <p className="msg-sheet-title">Clear the whole chat for you and {name}?</p>
          <p className="msg-sheet-note">
            Every message, yours and theirs, is removed from both accounts — photos and voice
            messages too. Anything sent after {Name} asked stays. This cannot be undone.
          </p>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={busy}
            onClick={onAcceptBoth}
          >
            Clear for both
          </button>
          <button type="button" role="menuitem" className="msg-sheet-cancel" onClick={onClose}>
            Cancel
          </button>
        </>
      )}
    </MenuSurface>
  );
}
