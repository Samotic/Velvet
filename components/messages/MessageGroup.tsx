'use client';

import Image from 'next/image';
import { useLayoutEffect, useRef } from 'react';

import { MoreHorizontal } from '@/components/icons';
import { Avatar } from '@/components/ui/Avatar';
import { clockTime } from '@/lib/format';
import { DELETED_BUBBLE_TEXT, bubbleShape } from '@/lib/messageEvents';
import { type MessageGroup as Group, type ThreadMessage, groupPosition } from '@/lib/messageGroups';

import { useLongPress } from './MessageMenu';
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

/**
 * One message row.
 *
 * A component rather than an inline map body because the long-press detector
 * is a hook, and a hook cannot live inside a loop.
 */
function MessageRow({
  m,
  mine,
  pos,
  last,
  otherName,
  otherPhoto,
  otherHref,
  collapsing,
  onOpenMenu,
}: {
  m: ThreadMessage;
  mine: boolean;
  pos: string;
  last: boolean;
  otherName: string | null | undefined;
  otherPhoto: string | null | undefined;
  otherHref: string | undefined;
  collapsing: boolean;
  onOpenMenu: (m: ThreadMessage, at: { x: number; y: number }) => void;
}) {
  const time = clockTime(m.createdAt);
  const shape = bubbleShape(m);
  const press = useLongPress((at) => onOpenMenu(m, at));
  const rowRef = useRef<HTMLDivElement>(null);

  /**
   * Drives the collapse by measuring first.
   *
   * A CSS transition needs two resolved endpoints and the natural height of a
   * row is `auto`, which is not one — animating straight to `max-height: 0`
   * would hold full height for the whole duration and then snap. So the
   * measured height is written, the browser is allowed to observe it, and zero
   * is set on the next frame.
   *
   * Layout effect, not `useEffect`: the first write has to land before paint,
   * or the row is briefly unconstrained and the thread jumps the way this is
   * meant to prevent.
   */
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el || !collapsing) return;

    el.style.maxHeight = `${el.scrollHeight}px`;
    const id = requestAnimationFrame(() => {
      el.style.maxHeight = '0px';
    });
    return () => cancelAnimationFrame(id);
  }, [collapsing]);

  /**
   * A tombstone takes no actions and an unsent bubble has no server identity
   * to act on yet — offering a menu on either would produce a request that
   * cannot succeed.
   */
  const actionable = shape !== 'deleted' && !m.sendState;

  return (
    <div ref={rowRef} className={`msg-row${collapsing ? ' collapsing' : ''}`}>
      {/* The gutter is present on every incoming row and holds the
          avatar only on the last, so the bubbles above stay flush with
          the one below instead of stepping left. */}
      {!mine && (
        <div className="msg-gutter">
          {last && <Avatar src={otherPhoto} name={otherName} size="sm" href={otherHref} />}
        </div>
      )}

      <div
        className={`bubble ${mine ? 'mine' : 'theirs'} ${pos}${
          shape === 'text' || shape === 'deleted' ? '' : ' media'
        }${shape === 'audio' ? ' voice' : ''}${shape === 'deleted' ? ' tombstone' : ''}${
          m.sendState ? ` ${m.sendState}` : ''
        }`}
        onContextMenu={
          actionable
            ? (e) => {
                e.preventDefault();
                onOpenMenu(m, { x: e.clientX, y: e.clientY });
              }
            : undefined
        }
        {...(actionable ? press : {})}
      >
        {/*
          Checked before `kind`, deliberately. A retracted photo is still
          `kind: 'image'` with no URL, so a renderer that asked about kind
          first would try to draw an image that is not there.
        */}
        {shape === 'deleted' && (
          <>
            <span className="bubble-text deleted">
              {DELETED_BUBBLE_TEXT}
              {last && <span className="bubble-time-shim" aria-hidden="true" />}
            </span>
            {last && (
              <time className="bubble-time" dateTime={m.createdAt}>
                {time}
              </time>
            )}
          </>
        )}

        {shape === 'text' && (
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
                {/* Beside the stamp, in the same muted weight — it is a fact
                    about when, not a second piece of chrome. */}
                {m.editedAt && <span className="edited-tag">edited</span>}
                {time}
              </time>
            )}
            {/* Not on the final bubble, where the stamp carries it instead. */}
            {!last && m.editedAt && <span className="edited-tag loose">edited</span>}
          </>
        )}

        {shape === 'image' && m.mediaUrl && (
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

        {shape === 'audio' && m.mediaUrl && (
          <VoiceNote src={m.mediaUrl} duration={m.mediaDuration} />
        )}
      </div>

      {/*
        Pointer-only. It sits at the bubble's outer edge and appears on hover,
        so it never covers content and never competes with the message at rest.
        Touch reaches the same menu by long-press, which is why this is hidden
        rather than duplicated there.
      */}
      {actionable && (
        <button
          type="button"
          className="bubble-more"
          aria-label="Message actions"
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onOpenMenu(m, { x: r.left, y: r.bottom });
          }}
        >
          <MoreHorizontal />
        </button>
      )}

      {/*
        A voice note's own duration already occupies the corner the
        stamp would take, and the bubble is a fixed 56px, so the stamp
        sits just beneath it instead of inside. The one deviation from
        "inside the last bubble", and only for this kind.
      */}
      {last && shape === 'audio' && (
        <time className="bubble-time under" dateTime={m.createdAt}>
          {time}
        </time>
      )}
    </div>
  );
}

export function MessageGroup({
  group,
  otherName,
  otherPhoto,
  otherHref,
  collapsing,
  onRetry,
  onOpenMenu,
}: {
  group: Group;
  otherName: string | null | undefined;
  otherPhoto: string | null | undefined;
  otherHref: string | undefined;
  /** Ids mid-collapse after a delete-for-me, still rendered while they animate. */
  collapsing: ReadonlySet<string>;
  /** Re-sends a message whose first attempt failed. */
  onRetry: (m: ThreadMessage) => void;
  onOpenMenu: (m: ThreadMessage, at: { x: number; y: number }) => void;
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

        {messages.map((m, i) => (
          <MessageRow
            key={m.id}
            m={m}
            mine={mine}
            pos={groupPosition(i, total)}
            last={i === total - 1}
            otherName={otherName}
            otherPhoto={otherPhoto}
            otherHref={otherHref}
            collapsing={collapsing.has(m.id)}
            onOpenMenu={onOpenMenu}
          />
        ))}

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
