/** Shared auth types. `AuthUser` mirrors the backend User with passwordHash
 *  stripped — the exact shape the API returns under { data: { user } }. */

import type { ContentType } from './contentTypes';

export type Gender = 'male' | 'female' | 'prefer_not_to_say';

/** Mood slugs, stored rather than the display labels. See lib/onboarding.ts. */
export type Mood =
  | 'dark_intense'
  | 'feel_good'
  | 'mind_bending'
  | 'epic_grand'
  | 'funny_light'
  | 'romantic';

export interface PinnedFilm {
  contentId: string;
  contentType: ContentType;
  title: string;
  poster: string | null;
}

/** How the account was created. A `google` account has no password at all. */
export type AuthProvider = 'local' | 'google';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  authProvider: AuthProvider;
  /**
   * Google accounts arrive verified. Local signups start false and flip when
   * the emailed link is opened — the advisor and messaging are gated on it.
   */
  emailVerified: boolean;
  profilePhoto: string | null;
  bio: string;
  age?: number;
  gender?: Gender;
  favouriteGenres: string[];
  favouriteMood?: Mood;
  pinnedFilms: PinnedFilm[];
  /** Confirmed follows only. Pending requests never grant access. */
  following: string[];
  /** Confirmed followers only. */
  followers: string[];
  followRequests: { from: string; createdAt: string }[];
  /** Visibility of profile activity; all follows require approval. */
  profileVisibility: 'public' | 'private';
  /** Mutual: off means you neither send receipts nor see them. */
  readReceipts?: boolean;
  /** Denormalized, accepted edges only — never counts a pending request. */
  followerCount: number;
  followingCount: number;
  /** Requests awaiting this user's decision. */
  pendingRequestCount: number;
  /** Lifts the advisor's daily cap. Set by hand — there is no paid tier. */
  isPro: boolean;
  aiMessagesUsedToday: number;
  aiMessagesResetAt: string;
  /** Drives the /onboarding gate — false sends a new account through setup. */
  onboardingCompleted: boolean;
  /** Highest step finished: 0 none, 1 profile, 2 avatar, 3 taste. Drives resume. */
  onboardingStep: number;
  createdAt: string;
  updatedAt: string;
}

/** A public profile: another user as seen by the signed-in one. */
export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  profilePhoto: string | null;
  bio: string;
  age?: number;
  gender?: Gender;
  favouriteGenres: string[];
  favouriteMood?: Mood;
  pinnedFilms: PinnedFilm[];
  followerCount: number;
  followingCount: number;
  filmCount: number;
  isPro: boolean;
  /** Whether the signed-in user follows them. False when logged out. */
  isFollowing: boolean;
  /**
   * A follow request sent but not yet accepted — the middle button state.
   * Mutually exclusive with `isFollowing`: an edge is pending or accepted,
   * never both.
   */
  followRequested: boolean;
  /** Whether a follow needs their approval. */
  profileVisibility: 'public' | 'private';
  /**
   * Whether they follow the signed-in user back. False when logged out.
   * `isFollowing && isFollowedBy` is the mutual-follow test that gates
   * messaging — see the note on `isMutual` in the API's messageController.
   */
  isFollowedBy: boolean;
  /**
   * They have asked to follow you and are waiting on an answer. The profile
   * shows Accept and Decline inline when this is true.
   */
  requestedYou: boolean;
  /** True when this is the signed-in user's own profile. */
  isMe: boolean;
  /** Only included when viewing your own profile. */
  pendingRequestCount?: number;
  createdAt: string;
}

export interface AuthPayload {
  token: string;
  user: AuthUser;
}

/**
 * `/signup` collects only an email and a password — the handle and display name
 * are step 1 of onboarding, so both are optional here. Supplying them creates a
 * fully formed account in one call and skips that step.
 */
export interface RegisterInput {
  email: string;
  password: string;
  username?: string;
  displayName?: string;
}

/** Step 1 of onboarding: the only required step. */
export interface OnboardingProfileInput {
  displayName: string;
  username: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

/** The payload for POST /api/auth/complete-onboarding (steps 3 and 4). */
export interface OnboardingInput {
  age: number;
  gender: Gender;
  favouriteGenres: string[];
  favouriteMood: Mood;
}

/** The payload for PUT /api/users/me. Every field optional — the edit screen
 *  sends only what changed. */
export interface ProfileUpdateInput {
  displayName?: string;
  bio?: string;
  age?: number;
  gender?: Gender;
  favouriteGenres?: string[];
  favouriteMood?: Mood;
  profilePhoto?: string | null;
  pinnedFilms?: PinnedFilm[];
  /** The privacy toggle controls access to profile activity. */
  profileVisibility?: 'public' | 'private';
  /** Mutual: off means you neither send read receipts nor see them. */
  readReceipts?: boolean;
}
