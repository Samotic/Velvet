'use client';

import { useEffect, useRef, useState } from 'react';

import { Camera, Close, Mic, Send, Smile, Stop } from '@/components/icons';
import { MAX_VOICE_SECONDS } from '@/lib/messages';

import type { useRecorder } from './useRecorder';

/** A small, dependency-free emoji set — enough to react, not a full picker. */
const EMOJI = [
  '😀', '😂', '🥹', '😍', '🤩', '😎', '🤔', '😴',
  '👍', '🙏', '👏', '🔥', '💯', '❤️', '💔', '✨',
  '🎬', '🍿', '🎮', '📺', '⭐', '😱', '😭', '🤯',
];

/** How tall the field is allowed to grow before it scrolls internally. */
const MAX_ROWS = 6;

/** Elapsed seconds as `m:ss`, for the recording indicator. */
const secs = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

/**
 * The message input and everything that can attach to a message.
 *
 * The attachment buttons live *inside* the field's container rather than
 * floating beside it: they act on the message being composed, so they belong to
 * it. Outside, they read as unrelated toolbar icons that happen to sit nearby.
 */
export function Composer({
  draft,
  onDraft,
  onSend,
  onPickPhoto,
  onVoiceNote,
  recorder,
  sending,
  attaching,
}: {
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  onPickPhoto: (f: File | undefined) => void;
  onVoiceNote: () => void;
  recorder: ReturnType<typeof useRecorder>;
  sending: boolean;
  attaching: boolean;
}) {
  const [showEmoji, setShowEmoji] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  /**
   * Auto-grow.
   *
   * Height is reset to `auto` before reading `scrollHeight`, because the
   * property reports the content height *within the current box* — measuring
   * without the reset means the field can grow but never shrink again.
   */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const max = line * MAX_ROWS + pad;

    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [draft]);

  // Dismiss the picker on an outside click, so it does not sit open over the
  // thread while the user is reading it.
  useEffect(() => {
    if (!showEmoji) return;
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setShowEmoji(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showEmoji]);

  const empty = !draft.trim();

  if (recorder.recording) {
    return (
      <div className="chat-composer">
        <div className="chat-composer-inner">
          <div className="chat-field recording">
            <button
              type="button"
              className="chat-icon"
              onClick={recorder.cancel}
              aria-label="Discard recording"
            >
              <Close />
            </button>

            <div className="rec-state">
              <span className="rec-dot" aria-hidden="true" />
              <span className="rec-time">{secs(recorder.seconds)}</span>
              <span className="rec-hint">{MAX_VOICE_SECONDS - recorder.seconds}s left</span>
            </div>

            <button
              type="button"
              className="chat-send"
              onClick={onVoiceNote}
              aria-label="Send voice message"
            >
              <Stop />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-composer">
      <div className="chat-composer-inner">
        <div className="chat-field">
          <div className="chat-emoji" ref={popRef}>
            <button
              type="button"
              className="chat-icon"
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
                      onDraft(draft + e);
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

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              onPickPhoto(e.target.files?.[0]);
              // Clear it, or picking the same file twice fires no change event.
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="chat-icon"
            onClick={() => fileRef.current?.click()}
            disabled={attaching}
            aria-label="Send a photo"
          >
            <Camera />
          </button>

          {/* Hidden rather than disabled where the browser cannot record: an
              always-dead button is a worse answer than no button. */}
          {recorder.supported && (
            <button
              type="button"
              className="chat-icon"
              onClick={onVoiceNote}
              disabled={attaching}
              aria-label="Record a voice message"
            >
              <Mic />
            </button>
          )}

          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={attaching ? 'Sending attachment' : 'Message'}
            rows={1}
            aria-label="Write a message"
          />

          <button
            type="button"
            className="chat-send"
            disabled={empty || sending}
            onClick={onSend}
            aria-label="Send message"
          >
            <Send />
          </button>
        </div>
      </div>
    </div>
  );
}
