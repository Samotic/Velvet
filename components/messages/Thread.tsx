'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { ArrowLeft } from '@/components/icons';
import { Avatar } from '@/components/ui/Avatar';
import { ApiError, api } from '@/lib/api';
import type { PublicProfile } from '@/lib/authTypes';
import { applyDeleted, applyDeletedForMe, applyEdited } from '@/lib/messageEvents';
import { type ThreadMessage, groupMessages } from '@/lib/messageGroups';
import {
  type DeleteScope,
  deleteMessage,
  editMessage,
  getThread,
  markThreadRead,
  sendMessage,
  sendPhoto,
  sendVoiceNote,
} from '@/lib/messages';
import { emitSocket, onSocket } from '@/lib/socket';

import { Composer } from './Composer';
import { MessageGroup } from './MessageGroup';
import { MessageMenu } from './MessageMenu';
import { useRecorder } from './useRecorder';

/** Matches the `.msg-row.collapsing` transition in globals.css. */
const COLLAPSE_MS = 150;

/** How long after the last keystroke we tell the other end typing stopped. */
const TYPING_IDLE = 1800;

/**
 * Within this many pixels of the bottom, the thread is "being read live" and
 * new messages scroll into view. Above it the reader is looking at history and
 * the viewport must not be yanked out from under them.
 */
const STICK_THRESHOLD = 120;

/** Three bubbles at alternating edges. No shimmer — a thread is not a feed. */
function ThreadSkeleton() {
  return (
    <div className="thread-inner" aria-hidden="true">
      {['in', 'out', 'in'].map((side, i) => (
        <div className={`msg-group ${side}`} key={i}>
          <div className="msg-row">
            {side === 'in' && <div className="msg-gutter" />}
            <div className="bubble-skeleton" style={{ width: i === 1 ? '38%' : '52%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Thread({ userId }: { userId: string }) {
  const toast = useToast();
  const { user: me } = useAuth();

  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [other, setOther] = useState<PublicProfile | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [theyType, setTheyType] = useState(false);
  const [following, setFollowing] = useState(false);
  // Starts open so the composer doesn't flash shut for the ordinary case; the
  // server's verdict lands a moment later, and the server is what enforces it.
  const [canMessage, setCanMessage] = useState(true);

  /** The open ⋯ menu, and where it was opened from. */
  const [menu, setMenu] = useState<{ m: ThreadMessage; at: { x: number; y: number } } | null>(
    null,
  );
  /** The message being reworded, plus the draft that was displaced to do it. */
  const [editing, setEditing] = useState<{ id: string; before: string } | null>(null);
  /** Ids still on screen while their removal animates. */
  const [collapsing, setCollapsing] = useState<ReadonlySet<string>>(new Set());
  /** Their pending removal timers, so a failed delete can call one off. */
  const collapseTimers = useRef(new Map<string, number>());

  const logRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSent = useRef(false);
  /** Whether the log is pinned to the bottom. Updated on every scroll. */
  const stick = useRef(true);

  /**
   * The ceiling can end a recording at any moment, and the sender is defined
   * further down this component. A ref keeps the hook's dependency on it stable
   * instead of reordering the whole body around a two-minute timer.
   */
  const sendClipRef = useRef<(clip: Blob | null) => void>(() => {});
  const recorder = useRecorder({ onAutoStop: (clip) => sendClipRef.current(clip) });

  /* --- load ------------------------------------------------------------- */

  useEffect(() => {
    const controller = new AbortController();
    setMessages(null);
    stick.current = true;

    getThread(userId, controller.signal)
      .then(({ messages: list, user, canMessage: allowed }) => {
        setMessages(list);
        setOther(user);
        setFollowing(user.isFollowing);
        setCanMessage(allowed);
        // Opening the thread is what marks it read.
        void markThreadRead(userId).catch(() => {});
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setMessages([]);
      });

    return () => controller.abort();
  }, [userId]);

  /**
   * Marks a row for the collapse transition, then drops it.
   *
   * Two steps rather than an immediate filter so the gap closes over 150ms
   * instead of the thread jumping. Declared before the socket effect that
   * calls it, and stable, so that effect does not resubscribe on every render.
   */
  const collapseThenRemove = useCallback((messageId: string) => {
    setCollapsing((prev) => new Set(prev).add(messageId));
    const id = window.setTimeout(() => {
      collapseTimers.current.delete(messageId);
      setMessages((prev) => (prev ? applyDeletedForMe(prev, { messageId }) : prev));
      setCollapsing((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }, COLLAPSE_MS);
    collapseTimers.current.set(messageId, id);
  }, []);

  /**
   * Calls off a collapse that has not finished.
   *
   * Needed because the removal is on a timer while the request that justifies
   * it is on the network. A delete that fails **faster** than the animation —
   * a 403 from a closed window is immediate — would otherwise be rolled back
   * into the list and then removed anyway a few milliseconds later by a timer
   * nobody cancelled, and the message would vanish despite the failure.
   */
  const cancelCollapse = useCallback((messageId: string) => {
    const id = collapseTimers.current.get(messageId);
    if (id !== undefined) {
      window.clearTimeout(id);
      collapseTimers.current.delete(messageId);
    }
    setCollapsing((prev) => {
      if (!prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
  }, []);

  // Timers outlive the component otherwise, and each one holds a setState that
  // would fire against an unmounted tree when the user navigates mid-animation.
  useEffect(() => {
    const timers = collapseTimers.current;
    return () => {
      // `forEach`, not `for…of`: this tsconfig targets below ES2015 without
      // downlevelIteration, so iterating a Map directly does not compile.
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  /* --- realtime --------------------------------------------------------- */

  useEffect(() => {
    const offNew = onSocket('message:new', (raw) => {
      const m = raw as ThreadMessage;
      // Only the open thread's traffic; the navbar handles the rest.
      if (m.senderId !== userId && m.receiverId !== userId) return;

      setMessages((prev) => {
        if (!prev) return prev;
        // The socket echoes our own sends back — don't double-render them.
        if (prev.some((x) => x.id === m.id)) return prev;
        return [...prev, m];
      });
      setTheyType(false);

      if (m.senderId === userId) void markThreadRead(userId).catch(() => {});
    });

    /**
     * Edits and deletes from the other end, and from my own other tabs.
     *
     * All three reconcile by `messageId` through the pure helpers in
     * `lib/messageEvents.ts`, which return the list unchanged when nothing
     * matched — so an event for a conversation this thread is not showing
     * costs a comparison and no re-render. That also makes the optimistic
     * path safe: the echo of my own edit lands on a row that already says the
     * same thing, and a duplicate is impossible by construction.
     */
    const offEdited = onSocket('message:edited', (p) => {
      setMessages((prev) => (prev ? applyEdited(prev, p) : prev));
    });

    const offDeleted = onSocket('message:deleted', (p) => {
      setMessages((prev) => (prev ? applyDeleted(prev, p) : prev));
    });

    // Mine only — the server never sends this to the other participant. The
    // row is collapsed first and removed after, so it does not vanish out of
    // a reader's peripheral vision.
    const offDeletedForMe = onSocket('message:deletedForMe', (p) => {
      collapseThenRemove(p.messageId);
    });

    const offStart = onSocket('typing:start', (p) => {
      if ((p as { userId: string }).userId === userId) setTheyType(true);
    });
    const offStop = onSocket('typing:stop', (p) => {
      if ((p as { userId: string }).userId === userId) setTheyType(false);
    });

    return () => {
      offNew();
      offEdited();
      offDeleted();
      offDeletedForMe();
      offStart();
      offStop();
    };
  }, [userId]);

  /* --- scroll ----------------------------------------------------------- */

  /**
   * Follow the conversation only while the reader is already at the bottom.
   *
   * An unconditional scroll-to-bottom is why chat apps snatch the view away
   * mid-sentence when a message lands: the person reading yesterday's history
   * did not ask to be moved.
   */
  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, theyType]);

  const onScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  }, []);

  // Never leave the other end with a stuck "is typing…".
  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (typingSent.current) emitSocket('typing:stop', { to: userId });
    },
    [userId],
  );

  /* --- typing ----------------------------------------------------------- */

  const onType = useCallback(
    (value: string) => {
      setDraft(value);

      if (!typingSent.current) {
        emitSocket('typing:start', { to: userId });
        typingSent.current = true;
      }
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => {
        emitSocket('typing:stop', { to: userId });
        typingSent.current = false;
      }, TYPING_IDLE);
    },
    [userId],
  );

  /* --- edit and delete -------------------------------------------------- */

  /** Loads a message into the composer, parking whatever was already typed. */
  const startEdit = useCallback(
    (m: ThreadMessage) => {
      setEditing({ id: m.id, before: draft });
      setDraft(m.text);
      setMenu(null);
    },
    [draft],
  );

  /** Leaves edit mode and puts the displaced draft back exactly as it was. */
  const cancelEdit = useCallback(() => {
    setEditing((cur) => {
      if (cur) setDraft(cur.before);
      return null;
    });
  }, []);

  /**
   * Saves a reword, optimistically.
   *
   * On failure the previous body is restored and the composer is *not*
   * reopened: the user has already seen their text land in the bubble, so
   * dropping them back into edit mode with the same string would read as the
   * edit having half-worked. The toast says what happened instead.
   */
  const submitEdit = useCallback(
    async (id: string, text: string) => {
      const before = messages?.find((m) => m.id === id);
      if (!before) return;

      const at = new Date().toISOString();
      setMessages((prev) => (prev ? applyEdited(prev, { messageId: id, text, editedAt: at }) : prev));
      setEditing(null);
      setDraft('');

      try {
        const saved = await editMessage(id, text);
        // The server's copy wins. An identical edit is answered 200 with
        // `editedAt` untouched, so this is what removes an "edited" label the
        // optimistic write had already painted.
        setMessages((prev) =>
          prev
            ? applyEdited(prev, {
                messageId: id,
                text: saved.text,
                editedAt: saved.editedAt ?? '',
              }).map((m) => (m.id === id ? { ...m, editedAt: saved.editedAt } : m))
            : prev,
        );
      } catch (err) {
        setMessages((prev) =>
          prev
            ? applyEdited(prev, {
                messageId: id,
                text: before.text,
                editedAt: before.editedAt ?? '',
              }).map((m) => (m.id === id ? { ...m, editedAt: before.editedAt } : m))
            : prev,
        );
        toast.bad(err instanceof ApiError ? err.message : "Couldn't edit message");
      }
    },
    [messages, toast],
  );

  /**
   * Deletes, optimistically, and rolls the whole list back on failure.
   *
   * The snapshot is the entire array rather than the one message: a retraction
   * clears several fields at once, and restoring them one by one is a second
   * description of the tombstone that could disagree with `applyDeleted`.
   */
  const removeMessage = useCallback(
    async (m: ThreadMessage, scope: DeleteScope) => {
      const snapshot = messages;
      setMenu(null);

      if (scope === 'me') collapseThenRemove(m.id);
      else {
        setMessages((prev) =>
          prev ? applyDeleted(prev, { messageId: m.id, deletedAt: new Date().toISOString() }) : prev,
        );
      }

      // A retracted message cannot still be being edited.
      setEditing((cur) => (cur?.id === m.id ? null : cur));

      try {
        await deleteMessage(m.id, scope);
      } catch (err) {
        // Call the timer off *before* restoring, or a fast failure gets the
        // list back and then loses the row again when the timer fires.
        cancelCollapse(m.id);
        if (snapshot) setMessages(snapshot);
        toast.bad(err instanceof ApiError ? err.message : "Couldn't delete message");
      }
    },
    [messages, collapseThenRemove, cancelCollapse, toast],
  );

  /* --- sending ---------------------------------------------------------- */

  /** Appends whatever the server saved, unless the socket echo beat us to it. */
  const absorb = useCallback((saved: ThreadMessage) => {
    setMessages((prev) => {
      if (!prev) return [saved];
      return prev.some((x) => x.id === saved.id) ? prev : [...prev, saved];
    });
  }, []);

  /**
   * Sends text optimistically.
   *
   * The bubble appears immediately with a temporary id and is swapped for the
   * server's copy on success. On failure it stays exactly where it is, marked
   * failed — the message the user wrote is not thrown away because a request
   * did not land.
   */
  const deliver = useCallback(
    async (text: string, tempId: string) => {
      try {
        const saved = await sendMessage(userId, text);
        setMessages((prev) =>
          (prev ?? []).some((x) => x.id === saved.id)
            ? (prev ?? []).filter((x) => x.id !== tempId)
            : (prev ?? []).map((x) => (x.id === tempId ? saved : x)),
        );
      } catch (err) {
        setMessages((prev) =>
          (prev ?? []).map((x) => (x.id === tempId ? { ...x, sendState: 'failed' as const } : x)),
        );
        if (err instanceof ApiError && err.status === 403) toast.bad(err.message);
      }
    },
    [userId, toast],
  );

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;

    /**
     * In edit mode the same key and the same button save a reword instead of
     * sending. One entry point rather than two, because the composer has one
     * primary action at any moment and the mode decides what it is — a second
     * handler would mean two places that could disagree about which is live.
     */
    if (editing) {
      await submitEdit(editing.id, text);
      return;
    }

    setDraft('');
    setSending(true);
    stick.current = true;

    if (typingSent.current) {
      emitSocket('typing:stop', { to: userId });
      typingSent.current = false;
    }

    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessages((prev) => [
      ...(prev ?? []),
      {
        id: tempId,
        conversationId: '',
        senderId: me?.id ?? '',
        receiverId: userId,
        kind: 'text',
        text,
        mediaUrl: null,
        mediaDuration: null,
        mediaWidth: null,
        mediaHeight: null,
        read: false,
        // An unsent bubble has never been edited or retracted. Spelled out
        // rather than left off so the optimistic row is the same shape as the
        // server's copy that replaces it — a partial one would make every
        // renderer guard against undefined on fields that are never absent.
        editedAt: null,
        deletedForEveryone: false,
        deletedAt: null,
        deletedBy: null,
        createdAt: new Date().toISOString(),
        sendState: 'sending',
      },
    ]);

    await deliver(text, tempId);
    setSending(false);
  }

  /** Re-sends a failed bubble in place, reusing its slot rather than adding one. */
  const retry = useCallback(
    (m: ThreadMessage) => {
      setMessages((prev) =>
        (prev ?? []).map((x) => (x.id === m.id ? { ...x, sendState: 'sending' as const } : x)),
      );
      void deliver(m.text, m.id);
    },
    [deliver],
  );

  async function onPickPhoto(file: File | undefined) {
    if (!file || attaching) return;
    setAttaching(true);
    stick.current = true;
    try {
      absorb(await sendPhoto(userId, file));
    } catch (err) {
      toast.bad(err instanceof ApiError || err instanceof Error ? err.message : 'Photo not sent');
    } finally {
      setAttaching(false);
    }
  }

  /**
   * Uploads a finished clip. Shared by the two ways recording ends — the user
   * pressing send, and the recorder hitting its two-minute ceiling — so a clip
   * that ran the full duration is sent rather than silently dropped.
   */
  const sendClip = useCallback(
    async (clip: Blob | null) => {
      if (!clip || clip.size === 0) return;
      setAttaching(true);
      stick.current = true;
      try {
        absorb(await sendVoiceNote(userId, clip));
      } catch (err) {
        toast.bad(
          err instanceof ApiError || err instanceof Error ? err.message : 'Voice message not sent',
        );
      } finally {
        setAttaching(false);
      }
    },
    [absorb, toast, userId],
  );

  useEffect(() => {
    sendClipRef.current = (clip) => void sendClip(clip);
  }, [sendClip]);

  /** Starts recording, or ends the one in progress and sends it. */
  async function onVoiceNote() {
    if (recorder.recording) {
      await sendClip(await recorder.stop());
      return;
    }

    if (attaching) return;
    if (!(await recorder.start())) toast.bad('Velvet could not reach your microphone');
  }

  async function toggleFollow() {
    if (!other) return;
    const next = !following;
    setFollowing(next);
    try {
      if (next) await api.post(`/api/users/${other.id}/follow`);
      else await api.del(`/api/users/${other.id}/follow`);
    } catch {
      setFollowing(!next);
      toast.bad('Could not update follow');
    }
  }

  const groups = useMemo(() => groupMessages(messages ?? [], me?.id), [messages, me?.id]);
  const profileHref = other ? `/profile/${other.username}` : undefined;

  return (
    <div className="msg-thread">
      {/* Sibling of the scroll container, not inside it. */}
      <div className="thread-head">
        {/* Back only matters on phones, where the inbox is a separate screen. */}
        <Link href="/messages" className="chat-icon" aria-label="Back to conversations">
          <ArrowLeft />
        </Link>

        <Avatar src={other?.profilePhoto} name={other?.displayName} href={profileHref} />

        <div className="thread-id">
          <Link href={profileHref ?? '#'} className="thread-name">
            {other?.displayName ?? 'Conversation'}
          </Link>
          {/*
            Presence would go here. Velvet tracks none — no lastSeen on the user
            model, nothing in the socket layer — so this line renders nothing
            rather than a follower count, which is not a fact about a
            conversation, or a placeholder pretending to be status.
          */}
        </div>

        {other && !other.isMe && (
          <button
            type="button"
            className={`btn-ghost${following ? ' on' : ''}`}
            onClick={() => void toggleFollow()}
          >
            {following ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      <div className="thread-log" ref={logRef} onScroll={onScroll}>
        {messages === null ? (
          <ThreadSkeleton />
        ) : (
          <div className="thread-inner">
            {messages.length === 0 && (
              <div className="thread-empty">
                <Avatar
                  src={other?.profilePhoto}
                  name={other?.displayName}
                  size="lg"
                  href={profileHref}
                />
                <div className="thread-empty-name">{other?.displayName ?? 'This person'}</div>
                <p className="thread-empty-line">Send a message to start the conversation.</p>
              </div>
            )}

            {groups.map((g) => (
              <MessageGroup
                key={g.id}
                group={g}
                otherName={other?.displayName}
                otherPhoto={other?.profilePhoto}
                otherHref={profileHref}
                collapsing={collapsing}
                onRetry={retry}
                onOpenMenu={(m, at) => setMenu({ m, at })}
              />
            ))}

            {theyType && (
              <div className="typing-line">{other?.displayName ?? 'They'} is typing…</div>
            )}
          </div>
        )}
      </div>

      {!canMessage ? (
        /* History above stays readable — only the ability to add to it stops. */
        <div className="chat-composer">
          <div className="chat-composer-inner">
            <p className="chat-locked">
              You and {other?.displayName ?? 'this person'} need to follow each other before you
              can message.
            </p>
          </div>
        </div>
      ) : (
        <Composer
          draft={draft}
          onDraft={onType}
          onSend={() => void send()}
          onPickPhoto={(f) => void onPickPhoto(f)}
          onVoiceNote={() => void onVoiceNote()}
          recorder={recorder}
          sending={sending}
          attaching={attaching}
          editing={editing !== null}
          onCancelEdit={cancelEdit}
        />
      )}

      {/*
        Rendered here rather than inside the row so exactly one can be open at
        a time — a menu owned by each bubble would let a second open behind the
        first on a fast right-click.
      */}
      {menu && (
        <MessageMenu
          message={menu.m}
          myId={me?.id ?? null}
          anchor={menu.at}
          onEdit={() => startEdit(menu.m)}
          onDelete={(scope) => void removeMessage(menu.m, scope)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
