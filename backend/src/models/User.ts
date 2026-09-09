import { Schema, model, type Types, type Model } from 'mongoose';

/** A title a user has pinned to their profile (max 5). */
export interface PinnedFilm {
  contentId: string;
  contentType: ContentType;
  title: string;
  poster: string | null;
}

/** The three catalogue kinds. `contentId` is a string throughout because IGDB
 *  and TMDB ids only coincide by accident — the pair (type, id) is the key. */
export type ContentType = 'movie' | 'series' | 'game';
export const CONTENT_TYPES: ContentType[] = ['movie', 'series', 'game'];

export type Gender = 'male' | 'female' | 'prefer_not_to_say';
export const GENDERS: Gender[] = ['male', 'female', 'prefer_not_to_say'];

/** The moods offered in onboarding step 4. Stored as the slug, not the label. */
export const MOODS = [
  'dark_intense',
  'feel_good',
  'mind_bending',
  'epic_grand',
  'funny_light',
  'romantic',
] as const;
export type Mood = (typeof MOODS)[number];

/** How the account signs in. A Google account has no password at all, which is
 *  why `passwordHash` is only required for `local`. */
export type AuthProvider = 'local' | 'google';
export const AUTH_PROVIDERS: AuthProvider[] = ['local', 'google'];

/** Visibility of profile content. All new follows require approval. */
export const PROFILE_VISIBILITIES = ['public', 'private'] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

/** The persisted user document. `passwordHash` is `select: false`, so it is
 *  omitted from queries unless explicitly requested, and stripped again by the
 *  toJSON transform — it must never leave the API. The verification and reset
 *  token fields are handled the same way. */
export interface IUser {
  email: string;
  username: string;
  /** Absent on Google accounts — check `authProvider` before comparing. */
  passwordHash?: string;
  authProvider: AuthProvider;
  /** Google's stable subject id. Sparse-unique: only Google accounts have one. */
  googleId?: string | null;
  /**
   * Google vouches for the address, so those accounts start verified. Local
   * signups start false and flip when the emailed link is opened.
   */
  emailVerified: boolean;
  /** SHA-256 of the emailed token — see `hashToken` in authController. */
  emailVerificationToken?: string | null;
  emailVerificationExpires?: Date | null;
  passwordResetToken?: string | null;
  passwordResetExpires?: Date | null;
  displayName: string;
  profilePhoto: string | null;
  bio: string;
  age?: number;
  gender?: Gender;
  favouriteGenres: string[];
  favouriteMood?: Mood;
  pinnedFilms: PinnedFilm[];
  /** Confirmed relationships only; mirrored from the Follow collection. */
  following: Types.ObjectId[];
  followers: Types.ObjectId[];
  /** Incoming requests awaiting a decision. */
  followRequests: { from: Types.ObjectId; createdAt: Date }[];
  /** Controls content visibility, independently of follow approval. */
  profileVisibility: ProfileVisibility;
  /**
   * Denormalized counts, maintained by `$inc` alongside every edge write.
   *
   * `countDocuments()` on render is the obvious alternative and it is wrong:
   * it gets slow exactly when an account gets popular, which is when its
   * profile is read most. Drift is repaired by `scripts/reconcileCounters.ts`.
   *
   * `followerCount` / `followingCount` count **accepted edges only** — a
   * pending request is not a follow, and showing it as one would leak that
   * someone requested.
   */
  followerCount: number;
  followingCount: number;
  pendingRequestCount: number;
  unreadNotificationCount: number;
  /**
   * Bumped to invalidate every token already issued for this account.
   *
   * A JWT is stateless: once signed it is valid until it expires, and this
   * project signs for seven days. Without a version to compare against, a
   * password reset changes nothing for whoever already holds a stolen token,
   * and logging out only clears the browser copy. This is the one number that
   * makes both of those actually end a session.
   */
  tokenVersion: number;
  /**
   * Lifts the advisor's daily cap. Not purchasable — Velvet is free and has no
   * paid tier; this is set by hand for the operator or a trusted account.
   */
  isPro: boolean;
  aiMessagesUsedToday: number;
  aiMessagesResetAt: Date;
  /** True once step 1 (name + handle) is done — that step is the only required one. */
  onboardingCompleted: boolean;
  /**
   * Highest onboarding step finished: 0 none, 1 profile, 2 avatar, 3 taste.
   * Steps 2 and 3 are skippable, so this is what lets a closed tab resume where
   * it left off rather than restarting the flow.
   */
  onboardingStep: number;
  /** Cloudinary's id for the avatar, so a replacement can delete the old file. */
  avatarPublicId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const pinnedFilmSchema = new Schema<PinnedFilm>(
  {
    contentId: { type: String, required: true },
    contentType: { type: String, enum: CONTENT_TYPES, default: 'movie' },
    title: { type: String, required: true },
    poster: { type: String, default: null },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
      // alphanumeric + underscore only
      match: /^[a-zA-Z0-9_]+$/,
    },
    passwordHash: {
      type: String,
      // Only local accounts have one. `this` is the document being validated;
      // a Google signup passes authProvider: 'google' and no hash.
      required: function (this: { authProvider?: AuthProvider }) {
        return (this.authProvider ?? 'local') === 'local';
      },
      // never selected by default — see login's explicit .select('+passwordHash')
      select: false,
    },
    authProvider: { type: String, enum: AUTH_PROVIDERS, default: 'local' },
    googleId: {
      type: String,
      // Deliberately NO `default`. `sparse` skips documents where the field is
      // *absent*, not where it is null — so defaulting to null would put every
      // local account into the unique index and the second signup would collide
      // on a duplicate null. Local accounts must simply not have the field.
      unique: true,
      sparse: true,
    },
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, default: null, select: false },
    emailVerificationExpires: { type: Date, default: null, select: false },
    passwordResetToken: { type: String, default: null, select: false },
    passwordResetExpires: { type: Date, default: null, select: false },
    displayName: { type: String, required: true, trim: true },
    profilePhoto: { type: String, default: null },
    bio: { type: String, maxlength: 160, default: '' },
    // 13 is the floor the onboarding form enforces; both ends agree.
    age: { type: Number, min: 13, max: 120 },
    gender: { type: String, enum: GENDERS },
    favouriteGenres: { type: [String], default: [] },
    favouriteMood: { type: String, enum: MOODS },
    pinnedFilms: {
      type: [pinnedFilmSchema],
      default: [],
      validate: {
        validator: (v: PinnedFilm[]) => v.length <= 5,
        message: 'You can pin up to 5 titles.',
      },
    },
    // Deprecated — see the interface. Retained purely for the migration script.
    following: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }],
    followers: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }],
    followRequests: {
      type: [new Schema({
        from: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        createdAt: { type: Date, default: Date.now },
      }, { _id: false })],
      default: [],
    },
    profileVisibility: { type: String, enum: PROFILE_VISIBILITIES, default: 'public' },
    followerCount: { type: Number, default: 0, min: 0 },
    followingCount: { type: Number, default: 0, min: 0 },
    pendingRequestCount: { type: Number, default: 0, min: 0 },
    unreadNotificationCount: { type: Number, default: 0, min: 0 },
    /**
     * Starts at 1, not 0.
     *
     * Every token signed before this field existed carries no `tokenVersion`
     * claim at all, and those must not pass. Treating a missing claim as 0
     * would let all of them through against a default of 0 — the exact silent
     * pass this is meant to prevent. Starting at 1 means "absent" can never
     * match, so the old sessions die once, on deploy, and every session after
     * that is checked properly.
     */
    tokenVersion: { type: Number, default: 1, min: 1 },
    isPro: { type: Boolean, default: false },
    aiMessagesUsedToday: { type: Number, default: 0 },
    aiMessagesResetAt: { type: Date, default: () => new Date() },
    onboardingCompleted: { type: Boolean, default: false },
    onboardingStep: { type: Number, default: 0, min: 0, max: 3 },
    avatarPublicId: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        // Expose `id`, hide Mongo internals, and — critically — never leak the
        // hash or any credential token. `select: false` already keeps these out
        // of ordinary queries; deleting here is the guarantee that an explicit
        // `.select('+…')` somewhere can't accidentally serialise one to a client.
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        delete ret.emailVerificationToken;
        delete ret.emailVerificationExpires;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        return ret;
      },
    },
  },
);

/** Powers /api/users/search — prefix matches on either name field. */
userSchema.index({ username: 1, displayName: 1 });

export type UserModel = Model<IUser>;

export const User: UserModel = model<IUser>('User', userSchema);
