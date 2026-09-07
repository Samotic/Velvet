'use client';

import Image from 'next/image';

import { Avatar } from '@/components/ui/Avatar';
import { clockTime } from '@/lib/format';
import { type MessageGroup as Group, type ThreadMessage, groupPosition } from '@/lib/messageGroups';

import { VoiceNote } from './VoiceNote';

/**
 * One sender's consecutive turn, rendered as a single utterance.
 *
 * Everything that appears once per group rather than once per message lives
 * here: the avatar, the sender's name, and the timestamp. Splitting it out of
 * `Thread` is what makes those "once per group" rules expressible at all — in a
 * flat map over messages each of them becomes an index comparison.
 */

/** Aspect-ratio box so the thread does not reflow when a photo finishes loading. */
function Photo({ m }: { m: ThreadMessage }) {
  const w = m.mediaWidth ?? 4;
  const h = m.mediaHeight ?? 3;

  return (
    <a
      href={m.mediaUrl ?? '#'}
      target="_blank"
      rel="noreferrer"
      className="bubble-photo"
      aria-label="Open photo full size"
    >
      {/*
        The ratio is held by the wrapper, not by the image, so the space is
        reserved from first paint — the image arrives into a box that is already
        the right shape. Without this the log jumps every time an older photo
        decodes, and any scroll position below it moves with the jump.
      */}
      <span className="photo-frame" style={{ aspectRatio: `${w} / ${h}` }}>
        <Image
          src={m.mediaUrl ?? ''}
          alt="Photo"
          width={w}
          height={h}
          sizes="320px"
          className="photo-img"
        />
      </span>
    </a>
  );
}

export function MessageGroup({
  group,
  otherName,
  otherPhoto,
  otherHref,
  onRetry,
}: {
  group: Group;
  otherName: string | null | undefined;
  otherPhoto: string | null | undefined;
  otherHref: string | undefined;
  /** Re-sends a message whose first attempt failed. */
  onRetry: (m: ThreadMessage) => void;
}) {
  const { mine, messages } = group;
  const total = messages.length;

  return (
    <>
      {group.dayLabel && (
        <div className="day-divider" role="separator">
          <span>{group.dayLabel}</span>
        </div>
      )}

      <div className={`msg-group ${mine ? 'out' : 'in'}`}>
        {/* Name once, above the first bubble, incoming only — on outgoing
            messages the sender is never in question. */}
        {!mine && otherName && <div className="group-name">{otherName}</div>}

        {messages.map((m, i) => {
          const last = i === total - 1;
          const pos = groupPosition(i, total);
          const time = clockTime(m.createdAt);
          const failed = m.sendState === 'failed';

          return (
            <div className="msg-row" key={m.id}>
              {/* The gutter is present on every incoming row and holds the
                  avatar only on the last, so the bubbles above stay flush with
                  the one below instead of stepping left. */}
              {!mine && (
                <div className="msg-gutter">
                  {last && (
                    <Avatar src={otherPhoto} name={otherName} size="sm" href={otherHref} />
                  )}
                </div>
              )}

              <div
                className={`bubble ${mine ? 'mine' : 'theirs'} ${pos}${
                  m.kind === 'text' ? '' : ' media'
                }${m.kind === 'audio' ? ' voice' : ''}${
                  m.sendState ? ` ${m.sendState}` : ''
                }`}
              >
                {m.kind === 'text' && (
                  <>
                    <span className="bubble-text">
                      {m.text}
                      {/*
                        Reserves room on the final line for the stamp that is
                        absolutely positioned over it. Without the shim a
                        timestamp lands on top of the last word whenever that
                        line happens to be full.
                      */}
                      {last && <span className="bubble-time-shim" aria-hidden="true" />}
                    </span>
                    {last && (
                      <time className="bubble-time" dateTime={m.createdAt}>
                        {time}
                      </time>
                    )}
                  </>
                )}

                {m.kind === 'image' && m.mediaUrl && (
                  <>
                    <Photo m={m} />
                    {/* On a photo the stamp sits on a scrim rather than a shim:
                        there is no text line to align to. */}
                    {last && (
                      <time className="bubble-time on-media" dateTime={m.createdAt}>
                        {time}
                      </time>
                    )}
                  </>
                )}

                {m.kind === 'audio' && m.mediaUrl && (
                  <VoiceNote src={m.mediaUrl} duration={m.mediaDuration} />
                )}
              </div>

              {/*
                A voice note's own duration already occupies the corner the
                stamp would take, and the bubble is a fixed 56px, so the stamp
                sits just beneath it instead of inside. The one deviation from
                "inside the last bubble", and only for this kind.
              */}
              {last && m.kind === 'audio' && (
                <time className="bubble-time under" dateTime={m.createdAt}>
                  {time}
                </time>
              )}
            </div>
          );
        })}

        {/* Failure is reported under the group, once, next to the edge the
            message sits on — not as a toast that disappears. */}
        {messages.some((m) => m.sendState === 'failed') && (
          <button
            type="button"
            className="send-retry"
            onClick={() => {
              const failed = messages.find((m) => m.sendState === 'failed');
              if (failed) onRetry(failed);
            }}
          >
            Not sent · Retry
          </button>
        )}
      </div>
    </>
  );
}
