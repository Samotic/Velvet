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

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  profilePhoto: string | null;
  bio: string;
  age?: number;
  gender?: Gender;
  favouriteGenres: string[];
  favouriteMood?: Mood;
  pinnedFilms: PinnedFilm[];
  following: string[];
  followers: string[];
  isPro: boolean;
  proExpiresAt: string | null;
  aiMessagesUsedToday: number;
  aiMessagesResetAt: string;
  /** Drives the /onboarding gate — false sends a new account through setup. */
  onboardingCompleted: boolean;
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
  /** True when this is the signed-in user's own profile. */
  isMe: boolean;
  createdAt: string;
}

export interface AuthPayload {
  token: string;
  user: AuthUser;
}

export interface RegisterInput {
  email: string;
  username: string;
  displayName: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
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
}
