/**
 * The shapes the UI consumes for catalogue content.
 *
 * These mirror `backend/src/services/catalogTypes.ts` exactly — the backend
 * maps TMDB films, TMDB series and IGDB games all into this one shape, so no
 * component ever branches on which source a row came from. Keep the two files
 * in step: if a field moves there, it moves here.
 */

/** The three catalogue kinds. */
export type ContentType = 'movie' | 'series' | 'game';

export const CONTENT_TYPES: ContentType[] = ['movie', 'series', 'game'];

/** The badge label the design shows on every poster card. */
export const TYPE_LABEL: Record<ContentType, string> = {
  movie: 'Film',
  series: 'Series',
  game: 'Game',
};

/**
 * Detail routes are per-type (`/movie/[id]`, `/series/[id]`, `/game/[id]`), so
 * every link goes through here rather than hardcoding `/movie/`.
 */
export const hrefFor = (type: ContentType, id: string) => `/${type}/${id}`;

export interface CatalogSummary {
  /** String throughout: TMDB and IGDB ids only coincide by accident, so the
   *  real key is the (type, id) pair. */
  id: string;
  type: ContentType;
  title: string;
  year: string | null;
  posterUrl: string | null;
  /** 0-10, one decimal. Null when the source has no score yet. */
  score: number | null;
  overview: string;
  genres: string[];
}

export interface CatalogCredit {
  id: string;
  name: string;
  role: string;
  photoUrl: string | null;
}

export interface CatalogDetail extends CatalogSummary {
  backdropUrl: string | null;
  tagline: string | null;
  runtime: string | null;
  runtimeMinutes: number | null;
  certification: string | null;
  trailerUrl: string | null;
  voteCount: number;
  cast: CatalogCredit[];
  similar: CatalogSummary[];
}

/* ------------------------------ ratings ---------------------------------- */

/** The author block the API populates onto ratings, replies and activity. */
export interface UserRef {
  id: string;
  username: string;
  displayName: string;
  profilePhoto: string | null;
}

export interface ReviewReply {
  id: string;
  user: UserRef;
  text: string;
  createdAt: string;
}

/** A rating and a review are one document — `review` is simply empty when the
 *  user rated without writing anything. */
export interface Review {
  id: string;
  user: UserRef;
  contentId: string;
  contentType: ContentType;
  contentTitle: string;
  poster: string | null;
  /** 1-5. */
  rating: number;
  review: string;
  likeCount: number;
  /** Whether the signed-in user has liked it. False when logged out. */
  likedByMe: boolean;
  replies: ReviewReply[];
  createdAt: string;
}

/** The community panel on a detail screen. */
export interface RatingSummary {
  average: number | null;
  count: number;
  /** Counts for 1★ through 5★, index 0 = 1★. */
  distribution: [number, number, number, number, number];
}

/* ----------------------------- watchlist --------------------------------- */

export const WATCH_STATUSES = ['want', 'watching', 'finished'] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];

export const WATCH_STATUS_LABEL: Record<WatchStatus, string> = {
  want: 'Want to Watch',
  watching: 'Currently Watching',
  finished: 'Finished',
};

export interface WatchlistItem {
  id: string;
  contentId: string;
  contentType: ContentType;
  contentTitle: string;
  poster: string | null;
  year: string | null;
  status: WatchStatus;
  progressPercent: number;
  /** The user's own rating, when they've left one. */
  myRating?: number | null;
  createdAt: string;
}

/* ---------------------------- notifications ------------------------------ */

export type NotificationType =
  | 'follow'
  | 'review_like'
  | 'review_reply'
  | 'message'
  | 'ai_picks'
  | 'available';

export interface Notification {
  id: string;
  type: NotificationType;
  /** Null for system notifications (`ai_picks`, `available`). */
  from: UserRef | null;
  contentId: string | null;
  contentType: ContentType | null;
  contentTitle: string | null;
  read: boolean;
  createdAt: string;
}

/* ------------------------------ messaging -------------------------------- */

export interface Conversation {
  id: string;
  /** The other participant — the API resolves "the one that isn't me". */
  user: UserRef;
  lastMessage: string;
  lastMessageAt: string | null;
  /** True when the last message was sent by the signed-in user. */
  lastFromMe: boolean;
  unread: number;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  text: string;
  read: boolean;
  createdAt: string;
}

/* ------------------------------- activity -------------------------------- */

export type ActivityAction = 'rated' | 'watchlisted' | 'finished' | 'reviewed';

export interface ActivityItem {
  id: string;
  user: UserRef;
  action: ActivityAction;
  contentId: string;
  contentType: ContentType;
  contentTitle: string;
  poster: string | null;
  /** Present on `rated` / `reviewed`. */
  rating?: number | null;
  createdAt: string;
}

/* --------------------------------- AI ------------------------------------ */

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Follow-up chips shown under an assistant turn. */
  suggestions: string[];
  createdAt: string;
}

/** What `POST /api/ai/chat` returns. */
export interface AiChatResponse {
  message: AiMessage;
  /** Remaining free messages today; null when the user is Pro (unlimited). */
  remaining: number | null;
}

/* -------------------------------- stats ---------------------------------- */

/** The figures behind the home stat strip and the profile stats section. */
export interface WatchStats {
  films: number;
  filmsThisYear: number;
  hours: number;
  topGenre: string | null;
  /** Genre name → count, for the profile's mini bar chart. */
  genreBreakdown: { genre: string; count: number }[];
  averageRating: number | null;
  /** Consecutive days with at least one rating. */
  streak: number;
}
