'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { ArrowLeft } from '@/components/icons';
import { Avatar } from '@/components/ui/Avatar';
import { ApiError, api } from '@/lib/api';
import type { PublicProfile } from '@/lib/authTypes';
import { type ThreadMessage, groupMessages } from '@/lib/messageGroups';
import { getThread, markThreadRead, sendMessage, sendPhoto, sendVoiceNote } from '@/lib/messages';
import { emitSocket, onSocket } from '@/lib/socket';

import { Composer } from './Composer';
import { MessageGroup } from './MessageGroup';
import { useRecorder } from './useRecorder';

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

    const offStart = onSocket('typing:start', (p) => {
      if ((p as { userId: string }).userId === userId) setTheyType(true);
    });
    const offStop = onSocket('typing:stop', (p) => {
      if ((p as { userId: string }).userId === userId) setTheyType(false);
    });

    return () => {
      offNew();
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
                onRetry={retry}
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
        />
      )}
    </div>
  );
}
