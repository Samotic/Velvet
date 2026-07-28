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

/** The persisted user document. `passwordHash` is `select: false`, so it is
 *  omitted from queries unless explicitly requested, and stripped again by the
 *  toJSON transform — it must never leave the API. */
export interface IUser {
  email: string;
  username: string;
  passwordHash: string;
  displayName: string;
  profilePhoto: string | null;
  bio: string;
  age?: number;
  gender?: Gender;
  favouriteGenres: string[];
  favouriteMood?: Mood;
  pinnedFilms: PinnedFilm[];
  following: Types.ObjectId[];
  followers: Types.ObjectId[];
  isPro: boolean;
  proExpiresAt: Date | null;
  aiMessagesUsedToday: number;
  aiMessagesResetAt: Date;
  onboardingCompleted: boolean;
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
      trim: true,
      minlength: 3,
      maxlength: 20,
      // alphanumeric + underscore only
      match: /^[a-zA-Z0-9_]+$/,
    },
    passwordHash: {
      type: String,
      required: true,
      // never selected by default — see login's explicit .select('+passwordHash')
      select: false,
    },
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
    following: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }],
    followers: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }],
    isPro: { type: Boolean, default: false },
    proExpiresAt: { type: Date, default: null },
    aiMessagesUsedToday: { type: Number, default: 0 },
    aiMessagesResetAt: { type: Date, default: () => new Date() },
    onboardingCompleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        // Expose `id`, hide Mongo internals, and — critically — never leak the hash.
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

/** Powers /api/users/search — prefix matches on either name field. */
userSchema.index({ username: 1, displayName: 1 });

export type UserModel = Model<IUser>;

export const User: UserModel = model<IUser>('User', userSchema);
