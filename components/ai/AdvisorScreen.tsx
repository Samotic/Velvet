'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { Send, Sparkle, VelvetMark } from '@/components/icons';
import { Avatar } from '@/components/ui/Avatar';
import { ApiError } from '@/lib/api';
import { getAiHistory, parseAiContent, sendAiMessage, SUGGESTED_QUESTIONS } from '@/lib/ai';
import type { AiMessage, WatchStats } from '@/lib/contentTypes';
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

          <p className="composer-note">
            {isPro
              ? 'Unlimited messages'
              : remaining !== null
                ? `${remaining} ${remaining === 1 ? 'message' : 'messages'} left today`
                : '10 messages a day · resets each morning'}
          </p>
        </div>
      </div>
    </div>
  );
}
