'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { ArrowLeft, Send, Smile } from '@/components/icons';
import { Avatar } from '@/components/ui/Avatar';
import { Loading } from '@/components/ui/States';
import { ApiError, api } from '@/lib/api';
import type { PublicProfile } from '@/lib/authTypes';
import type { DirectMessage } from '@/lib/contentTypes';
import { compactCount, messageGroupLabel } from '@/lib/format';
import { getThread, markThreadRead, sendMessage } from '@/lib/messages';
import { emitSocket, onSocket } from '@/lib/socket';

/** A small, dependency-free emoji set — enough to react, not a full picker. */
const EMOJI = [
  '😀', '😂', '🥹', '😍', '🤩', '😎', '🤔', '😴',
  '👍', '🙏', '👏', '🔥', '💯', '❤️', '💔', '✨',
  '🎬', '🍿', '🎮', '📺', '⭐', '😱', '😭', '🤯',
];

/** How long after the last keystroke we tell the other end typing stopped. */
const TYPING_IDLE = 1800;

export function Thread({ userId }: { userId: string }) {
  const toast = useToast();
  const { user: me } = useAuth();

  const [messages, setMessages] = useState<DirectMessage[] | null>(null);
  const [other, setOther] = useState<PublicProfile | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [theyType, setTheyType] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [following, setFollowing] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSent = useRef(false);

  /* --- load ------------------------------------------------------------- */

  useEffect(() => {
    const controller = new AbortController();
    setMessages(null);

    getThread(userId, controller.signal)
      .then(({ messages: list, user }) => {
        setMessages(list);
        setOther(user);
        setFollowing(user.isFollowing);
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
      const m = raw as DirectMessage;
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

  // Stick to the bottom as the conversation grows.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, theyType]);

  // Make sure we never leave the other end with a stuck "is typing…".
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

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;

    setDraft('');
    setShowEmoji(false);
    setSending(true);

    if (typingSent.current) {
      emitSocket('typing:stop', { to: userId });
      typingSent.current = false;
    }

    try {
      const saved = await sendMessage(userId, text);
      setMessages((prev) => {
        if (!prev) return [saved];
        return prev.some((x) => x.id === saved.id) ? prev : [...prev, saved];
      });
    } catch (err) {
      setDraft(text);
      toast.bad(err instanceof ApiError ? err.message : 'Message not sent');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
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

  if (messages === null) return <div className="msg-thread"><Loading /></div>;

  return (
    <div className="msg-thread">
      <div className="thread-head">
        {/* Back only matters on phones, where the inbox is a separate screen. */}
        <Link
          href="/messages"
          className="icon-action"
          aria-label="Back to conversations"
          style={{ display: 'flex' }}
        >
          <ArrowLeft />
        </Link>

        <Avatar
          src={other?.profilePhoto}
          name={other?.displayName}
          href={other ? `/profile/${other.username}` : undefined}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={other ? `/profile/${other.username}` : '#'} className="thread-name">
            {other?.displayName ?? 'Conversation'}
          </Link>
          <div className="thread-sub">
            {other ? `${compactCount(other.followerCount)} followers` : ''}
          </div>
        </div>

        {other && !other.isMe && (
          <button
            type="button"
            className={`btn-outline${following ? ' on' : ''}`}
            onClick={() => void toggleFollow()}
          >
            {following ? 'Following ✓' : 'Follow'}
          </button>
        )}
      </div>

      <div className="thread-log" ref={logRef}>
        {messages.length === 0 && (
          <div className="empty" style={{ margin: 'auto' }}>
            <div className="empty-title">Say something</div>
            <div className="empty-text">
              This is the start of your conversation with {other?.displayName ?? 'them'}.
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const mine = m.senderId === me?.id;
          // A timestamp divider whenever more than 20 minutes has passed.
          const prev = messages[i - 1];
          const gap =
            !prev ||
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 20 * 60 * 1000;

          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {gap && <div className="thread-divider">{messageGroupLabel(m.createdAt)}</div>}
              <div className={`bubble ${mine ? 'mine' : 'theirs'}`}>{m.text}</div>
            </div>
          );
        })}

        {theyType && (
          <div className="typing-line">{other?.displayName ?? 'They'} is typing…</div>
        )}
      </div>

      <div className="composer">
        <div className="composer-row" style={{ position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="icon-action"
              aria-label="Insert emoji"
              aria-expanded={showEmoji}
              onClick={() => setShowEmoji((v) => !v)}
            >
              <Smile />
            </button>

            {showEmoji && (
              <div className="emoji-pop" role="menu">
                {EMOJI.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      setDraft((d) => d + e);
                      setShowEmoji(false);
                      inputRef.current?.focus();
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message…"
            rows={1}
            aria-label="Write a message"
          />

          <button
            type="button"
            className="send-btn"
            disabled={!draft.trim() || sending}
            onClick={() => void send()}
            aria-label="Send message"
          >
            <Send />
          </button>
        </div>
      </div>
    </div>
  );
}
