/**
 * The Velvet icon set.
 *
 * All line icons share one 24×24 grid and a 2px stroke, and inherit
 * `currentColor` so the indigo comes from whatever context they sit in — a
 * `.nav-link.active`, a `.score`, a `.btn-primary`. Solid icons declare
 * `fill="currentColor"` for the same reason.
 */

type IconProps = { className?: string };
type SizedProps = { size?: number; className?: string };

const line = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/* ------------------------------ navigation ------------------------------- */

export const Home = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const Search = (p: IconProps) => (
  <svg {...line} {...p}>
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4-4" />
  </svg>
);

export const Profile = (p: IconProps) => (
  <svg {...line} {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21v-2a6 6 0 0 1 12 0v2" />
  </svg>
);

/** AI advisor — a twin sparkle. */
export const Sparkle = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z" />
  </svg>
);

export const MessageIcon = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-5a8.4 8.4 0 0 1-.9-3.8 8.4 8.4 0 0 1 8.4-8.4h.6a8.4 8.4 0 0 1 8 8z" />
  </svg>
);

export const Bell = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

export const Settings = (p: IconProps) => (
  <svg {...line} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

/* -------------------------------- actions -------------------------------- */

export const ChevronLeft = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const ChevronRight = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);

export const ArrowLeft = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M19 12H5" />
    <path d="M12 19l-7-7 7-7" />
  </svg>
);

export const Share = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <path d="M16 6l-4-4-4 4" />
    <path d="M12 2v13" />
  </svg>
);

export const Bookmark = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

export const BookmarkFilled = ({ size = 18, className }: SizedProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

export const Plus = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Close = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

export const Check = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const Send = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M22 2L11 13" />
    <path d="M22 2l-7 20-4-9-9-4z" />
  </svg>
);

export const Smile = (p: IconProps) => (
  <svg {...line} {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <path d="M9 9h.01M15 9h.01" />
  </svg>
);

export const Reply = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M9 17l-5-5 5-5" />
    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
  </svg>
);

export const Camera = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

/** The composer's record button. */
export const Mic = (p: IconProps) => (
  <svg {...line} {...p}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v4" />
  </svg>
);

/** Stops a recording, and pauses voice-note playback. */
export const Stop = (p: IconProps) => (
  <svg {...line} {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const Logout = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export const Filter = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M4 7h16M4 12h10M4 17h6" />
  </svg>
);

/* --------------------------------- solid --------------------------------- */

export const PlayFilled = ({ size = 18, className }: SizedProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M5 3l16 9-16 9z" />
  </svg>
);

/** The other half of the voice-note transport control. */
export const PauseFilled = ({ size = 18, className }: SizedProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
  </svg>
);

/** Inherits its colour, so the indigo comes from the surrounding context. */
export const StarFilled = ({ size = 15, className }: SizedProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2l3 6.5 7 .9-5 4.8 1.3 7L12 18l-6.6 3.2L6.7 14l-5-4.8 7-.9z" />
  </svg>
);

/** The rate-card star. Inside `.star` the CSS drives fill/stroke; anywhere else
 *  it inherits colour. */
export const StarOutline = (p: IconProps) => (
  <svg viewBox="0 0 24 24" strokeWidth={1.5} fill="none" stroke="currentColor" {...p}>
    <path d="M12 2l3 6.5 7 .9-5 4.8 1.3 7L12 18l-6.6 3.2L6.7 14l-5-4.8 7-.9z" />
  </svg>
);

export const Heart = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
  </svg>
);

export const HeartFilled = ({ size = 16, className }: SizedProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
  </svg>
);

/** Marks an account whose advisor cap has been lifted by hand. */
export const Crown = ({ size = 14, className }: SizedProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M3 18h18l-1.6-9-4.4 3.6L12 6l-3 6.6L4.6 9z" />
  </svg>
);

/** The Velvet mark, used as the AI avatar and the onboarding logo glyph. */
export const VelvetMark = ({ size = 22, className }: SizedProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4 4l8 16 8-16" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" />
    <circle cx="12" cy="9" r="1.8" fill="currentColor" />
  </svg>
);

/** The empty-state illustration for the messages inbox. */
export const ChatBubbles = ({ className }: IconProps) => (
  <svg
    viewBox="0 0 96 72"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinejoin="round"
    className={className}
  >
    <path d="M6 12a6 6 0 0 1 6-6h44a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H26L14 50V40h-2a6 6 0 0 1-6-6z" />
    <path
      d="M40 30a6 6 0 0 1 6-6h38a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6h-2v10L70 54H46a6 6 0 0 1-6-6z"
      opacity=".55"
    />
  </svg>
);

/* ------------------------- message actions ------------------------------- */

/** The ⋯ affordance on a bubble. Horizontal, so it reads as "more about this
 *  row" rather than the vertical "more app options" in the nav. */
export const MoreHorizontal = (p: IconProps) => (
  <svg {...line} {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const Copy = (p: IconProps) => (
  <svg {...line} {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const Pencil = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

export const Trash = (p: IconProps) => (
  <svg {...line} {...p}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);
