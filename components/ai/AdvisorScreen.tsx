'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { Close, Mic, Send, Sparkle, Stop, VelvetMark } from '@/components/icons';
import { Avatar } from '@/components/ui/Avatar';
import { ApiError } from '@/lib/api';
import {
  AI_DAILY_MESSAGES,
  getAiHistory,
  parseAiContent,
  sendAiMessage,
  sendAiVoiceNote,
  SUGGESTED_QUESTIONS,
} from '@/lib/ai';
import { useRecorder } from '@/components/messages/useRecorder';
import { MAX_VOICE_SECONDS } from '@/lib/messages';
import { hrefFor, type AiMessage, type WatchStats } from '@/lib/contentTypes';
import { moodLabel } from '@/lib/onboarding';
import { getWatchStats } from '@/lib/ratings';

export function AdvisorScreen() {
  return (
    <ProtectedRoute>
      <Advisor />
    </ProtectedRoute>
  );
}

function Advisor() {
  const params = useSearchParams();
  const toast = useToast();
  const { user } = useAuth();

  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [stats, setStats] = useState<WatchStats | null>(null);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Guards the `?q=` autosend so a re-render can't fire it twice. */
  const autoSent = useRef(false);

  /* --- initial load ----------------------------------------------------- */

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getAiHistory(controller.signal).catch(() => [] as AiMessage[]),
      getWatchStats().catch(() => null),
    ])
      .then(([history, s]) => {
        setMessages(history);
        setStats(s);
      })
      .finally(() => setReady(true));
    return () => controller.abort();
  }, []);

  /* --- scrolling -------------------------------------------------------- */

  // Pin to the bottom whenever the log grows or the indicator appears.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  /* --- sending ---------------------------------------------------------- */

  const send = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body || thinking) return;

      // Show the user's turn immediately with a provisional id; the server's
      // canonical copy arrives with the response.
      const provisional: AiMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: body,
        suggestions: [],
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, provisional]);
      setDraft('');
      setThinking(true);

      try {
        const res = await sendAiMessage(body);
        setMessages((prev) => [...prev, res.message]);
        setRemaining(res.remaining);
      } catch (err) {
        // Roll the optimistic turn back so the log doesn't show a question
        // that was never actually answered.
        setMessages((prev) => prev.filter((m) => m.id !== provisional.id));
        setDraft(body);

        // A 429 is the daily cap; the server's own message explains it.
        if (err instanceof ApiError && err.status === 503) {
          toast.bad('The advisor is not configured yet.');
        } else {
          toast.bad(err instanceof ApiError ? err.message : 'The advisor could not reply');
        }
      } finally {
        setThinking(false);
        inputRef.current?.focus();
      }
    },
    [thinking, toast],
  );

  // A question arriving via `?q=` (from a detail page's "Ask AI") sends itself
  // once the history has loaded, so it lands after any prior conversation.
  useEffect(() => {
    if (!ready || autoSent.current) return;
    const q = params.get('q');
    if (!q) return;
    autoSent.current = true;
    void send(q);
  }, [ready, params, send]);

  /**
   * Asks a spoken question.
   *
   * No optimistic bubble, unlike the typed path: until the server has
   * transcribed the clip nobody — including the person who recorded it —
   * knows what it says, so there is nothing honest to show. The thinking
   * indicator covers the wait, and the user's turn arrives already written.
   */
  const sendClip = useCallback(
    async (clip: Blob | null) => {
      if (!clip || thinking) return;

      setThinking(true);
      try {
        const res = await sendAiVoiceNote(clip);
        // Both turns: the transcript the server heard, then the reply to it.
        setMessages((prev) => [...prev, ...(res.userMessage ? [res.userMessage] : []), res.message]);
        setRemaining(res.remaining);
      } catch (err) {
        toast.bad(err instanceof ApiError ? err.message : 'The advisor could not hear that');
      } finally {
        setThinking(false);
        inputRef.current?.focus();
      }
    },
    [thinking, toast],
  );

  const sendClipRef = useRef<(clip: Blob | null) => void>(() => {});
  const recorder = useRecorder({ onAutoStop: (clip) => sendClipRef.current(clip) });
  useEffect(() => {
    sendClipRef.current = (clip) => void sendClip(clip);
  }, [sendClip]);

  /** Starts recording, or ends the one in progress and sends it. */
  async function onVoice() {
    if (recorder.recording) {
      await sendClip(await recorder.stop());
      return;
    }
    if (!(await recorder.start())) toast.bad('Velvet could not reach your microphone');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  const isPro = user?.isPro ?? false;

  return (
    <div className="ai-shell">
      {/* ---------------------------- taste panel --------------------------- */}
      <aside className="ai-side">
        <div className="ai-side-user">
          <Avatar src={user?.profilePhoto} name={user?.displayName} size="lg" />
          <div>
            <div className="ai-side-name">{user?.displayName}</div>
            <div className="ai-side-handle">@{user?.username}</div>
          </div>
        </div>

        <div className="ai-side-block">
          <div className="ai-side-label">Your taste</div>
          {user?.favouriteGenres.length ? (
            <div className="ai-side-tags">
              {user.favouriteGenres.map((g) => (
                <span key={g} className="chip static chip-sm">
                  {g}
                </span>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>No genres chosen yet.</p>
          )}
          {user?.favouriteMood && (
            <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 12 }}>
              Mood: <b style={{ color: 'var(--accent-bright)' }}>{moodLabel(user.favouriteMood)}</b>
            </p>
          )}
        </div>

        <div className="ai-side-block">
          <div className="ai-side-stats">
            <div className="ai-side-stat">
              <div className="n">{stats ? stats.films : '—'}</div>
              <div className="l">Films</div>
            </div>
            <div className="ai-side-stat">
              <div className="n">
                {stats?.averageRating != null ? stats.averageRating.toFixed(1) : '—'}
              </div>
              <div className="l">Avg rating</div>
            </div>
          </div>
          <Link href="/profile/edit" className="btn-outline" style={{ marginTop: 18, width: '100%' }}>
            Update my taste
          </Link>
        </div>

        <div className="ai-suggestions">
          <div className="ai-side-label">Try asking</div>
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              className="ai-suggestion"
              disabled={thinking}
              onClick={() => void send(q)}
            >
              {q}
            </button>
          ))}
        </div>
      </aside>

      {/* ------------------------------- chat ------------------------------- */}
      <div className="ai-main">
        <div className="ai-log" ref={logRef}>
          {ready && messages.length === 0 && !thinking && (
            <div className="empty" style={{ margin: 'auto' }}>
              <div className="empty-ic">
                <Sparkle />
              </div>
              <div className="empty-title">Ask me anything</div>
              <div className="empty-text">
                I know your taste — {user?.favouriteGenres.slice(0, 3).join(', ') || 'tell me more'}
                {user?.favouriteMood ? `, and that you lean ${moodLabel(user.favouriteMood)?.toLowerCase()}` : ''}.
                Start with a question, or pick one from the left.
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role === 'user' ? 'from-me' : 'from-ai'}`}>
              {m.role === 'assistant' && (
                <span className="msg-avatar" aria-hidden>
                  <VelvetMark size={17} />
                </span>
              )}

              <div style={{ minWidth: 0 }}>
                <div className="msg-bubble">
                  {parseAiContent(m.content).map((seg, i) =>
                    seg.href ? (
                      <Link key={i} href={seg.href}>
                        {seg.text}
                      </Link>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    ),
                  )}
                </div>

                {/*
                  Posters for the titles this reply recommended. Resolved from
                  the catalogue, never generated — see AiMedia.

                  `unoptimized` on purpose. These are already TMDB CDN URLs,
                  sized and cached by TMDB; routing them through next/image
                  would put every poster through Vercel's optimiser and bill
                  the transformation and the bandwidth to us for artwork
                  somebody else is already serving well. The direct-message
                  Photo component keeps the optimiser — its images are ours, on
                  Cloudinary, and arbitrary sizes from a camera roll are
                  exactly what it earns its keep on.

                  The wrapper holds the ratio, so the row is the right height
                  before a byte arrives and the thread does not jump.
                */}
                {m.role === 'assistant' && (m.media?.length ?? 0) > 0 && (
                  <div className="ai-media">
                    {m.media!.map((art) => (
                      <Link
                        key={`${art.contentType}-${art.contentId}`}
                        href={hrefFor(art.contentType, art.contentId)}
                        className="ai-media-item"
                        style={{ aspectRatio: String(art.aspect) }}
                        aria-label={art.title}
                      >
                        <Image
                          src={art.url}
                          alt={art.title}
                          fill
                          unoptimized
                          loading="lazy"
                          sizes="120px"
                        />
                      </Link>
                    ))}
                  </div>
                )}

                {m.role === 'assistant' && m.suggestions.length > 0 && (
                  <div className="msg-chips">
                    {m.suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="chip chip-sm"
                        disabled={thinking}
                        onClick={() => void send(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {thinking && (
            <div className="msg from-ai">
              <span className="msg-avatar" aria-hidden>
                <VelvetMark size={17} />
              </span>
              <div className="msg-bubble" style={{ padding: 0 }}>
                <span className="typing" aria-label="Velvet is thinking">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="composer">
          {recorder.recording ? (
            /* The field is replaced rather than disabled: there is nothing to
               type into while recording, and a dead textarea beside a live
               timer invites the user to try. */
            <div className="composer-row recording">
              <button
                type="button"
                className="ai-mic"
                onClick={recorder.cancel}
                aria-label="Discard recording"
              >
                <Close />
              </button>
              <div className="rec-state">
                <span className="rec-dot" aria-hidden="true" />
                <span className="rec-time">
                  {Math.floor(recorder.seconds / 60)}:
                  {String(recorder.seconds % 60).padStart(2, '0')}
                </span>
                <span className="rec-hint">{MAX_VOICE_SECONDS - recorder.seconds}s left</span>
              </div>
              <button
                type="button"
                className="send-btn"
                onClick={() => void onVoice()}
                aria-label="Send voice question"
              >
                <Stop />
              </button>
            </div>
          ) : (
            <div className="composer-row">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="What are you in the mood for?"
                rows={1}
                aria-label="Message the advisor"
              />
              {/* Hidden where the browser cannot record — `getUserMedia` needs a
                  secure context, so on plain http this button could only fail. */}
              {recorder.supported && (
                <button
                  type="button"
                  className="ai-mic"
                  disabled={thinking}
                  onClick={() => void onVoice()}
                  aria-label="Ask by voice"
                >
                  <Mic />
                </button>
              )}
              <button
                type="button"
                className="send-btn"
                disabled={!draft.trim() || thinking}
                onClick={() => void send(draft)}
                aria-label="Send"
              >
                <Send />
              </button>
            </div>
          )}

          <p className="composer-note">
            {isPro
              ? 'Unlimited messages'
              : remaining !== null
                ? `${remaining} ${remaining === 1 ? 'message' : 'messages'} left today`
                : `${AI_DAILY_MESSAGES} messages a day · resets each morning`}
          </p>
        </div>
      </div>
    </div>
  );
}
