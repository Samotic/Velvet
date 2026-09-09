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
  /** @deprecated Split into `new_follower` / `follow_request`. Old rows only. */
  | 'follow'
  | 'new_follower'
  | 'follow_request'
  | 'follow_accepted'
  | 'review_like'
  | 'review_reply'
  | 'message'
  | 'ai_picks'
  | 'available';

/** How a `follow_request` card was resolved. Null on every other type. */
export type ActionState = 'pending' | 'accepted' | 'declined';

/** The actor, plus the social proof the card shows beneath their handle. */
export interface NotificationActor extends UserRef {
  ratingCount: number;
}

export interface Notification {
  id: string;
  type: NotificationType;
  /** Null for system notifications (`ai_picks`, `available`). */
  from: UserRef | null;
  /** Same person as `from`, with `ratingCount`. Null for system rows. */
  actor: NotificationActor | null;
  contentId: string | null;
  contentType: ContentType | null;
  contentTitle: string | null;
  read: boolean;
  actionState: ActionState | null;
  /** The Follow edge id — what accept/decline act on. */
  followRequestId: string | null;
  /** Drives Follow back: true only for a settled follow, not a request. */
  viewerFollowsActor: boolean;
  /** So the button reads "Requested" rather than offering Follow again. */
  viewerRequestedActor: boolean;
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

/** Mirrors `MESSAGE_KINDS` in backend/src/models/Message.ts. */
export type MessageKind = 'text' | 'image' | 'audio';

export interface DirectMessage {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  /** Which of the three shapes this is. The renderer branches on this, never
   *  on whether `mediaUrl` happens to be set. */
  kind: MessageKind;
  /** The body for `kind: 'text'`; empty on a media message. */
  text: string;
  /** Cloudinary URL for a photo or voice note; null on text. */
  mediaUrl: string | null;
  /** Seconds, for `kind: 'audio'` — measured server-side at upload. */
  mediaDuration: number | null;
  /** Natural size, for `kind: 'image'`, so the bubble reserves the right box
   *  and the log doesn't jump as photos load. */
  mediaWidth: number | null;
  mediaHeight: number | null;
  read: boolean;
  /**
   * When the body was last edited; null means never. Drives the `edited`
   * label, and it is the *only* signal for it — a client that inferred
   * "edited" from anything else would disagree with the server the moment a
   * no-op edit was rejected without stamping this.
   */
  editedAt: string | null;
  /**
   * The tombstone. When true the server has already cleared `text` and
   * `mediaUrl`, so a renderer must branch on this **before** reading either:
   * a deleted photo and a deleted voice note both arrive as an empty text
   * message otherwise.
   */
  deletedForEveryone: boolean;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
}

/**
 * `editHistory` and `deletedFor` are deliberately absent above.
 *
 * The server strips both in `Message.toJSON` — the first is the sender's own
 * superseded drafts, the second would tell each participant what the other
 * has hidden. A message deleted for me simply never arrives; there is no
 * client-side filtering to do, and no type here should invite any.
 */

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

/**
 * Artwork attached to an advisor reply.
 *
 * Resolved from the catalogue, never generated: the advisor names titles as
 * `[[Title]]`, the server searches those to build the links, and the poster is
 * a field of that same response. Mirrors `AdvisorMedia` in
 * backend/src/services/catalogTypes.ts.
 *
 * Its own array rather than markers in the prose — the text may stream one day
 * and this cannot, because it needs the finished reply to know which titles
 * were named.
 */
export interface AiMedia {
  contentId: string;
  contentType: ContentType;
  title: string;
  /** A TMDB or IGDB CDN URL. Rendered unoptimised — see AdvisorScreen. */
  url: string;
  kind: 'poster';
  /** Width ÷ height. Reserves the box before the bytes land. */
  aspect: number;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Follow-up chips shown under an assistant turn. */
  suggestions: string[];
  /** Up to three posters for the titles this reply recommended. */
  media?: AiMedia[];
  createdAt: string;
}

/** What `POST /api/ai/chat` returns. */
export interface AiChatResponse {
  message: AiMessage;
  /**
   * The stored user turn.
   *
   * Redundant for a typed question, which the client already showed
   * optimistically. Load-bearing for a spoken one: the transcript is produced
   * server-side, so this is the only way the asker sees what was heard — which
   * matters most when it was heard wrong.
   */
  userMessage: AiMessage;
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
