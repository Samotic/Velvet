import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';

import { User } from '../models/User';
import { fail, ok } from '../utils/http';
import { signToken } from '../utils/jwt';
import {
  cleanGenres,
  escapeRegex,
  isEmail,
  isGender,
  isMood,
  isNonEmptyString,
  isUsername,
  isValidAge,
  isValidPassword,
  MIN_GENRES,
  str,
} from '../utils/validation';

const SALT_ROUNDS = 12;

/** Case-insensitive exact match, so "Sam" and "sam" can't both be registered. */
const ciExact = (value: string) => new RegExp(`^${escapeRegex(value)}$`, 'i');

/* ------------------------------- register -------------------------------- */

export async function register(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    // ---- validation (matches the frontend rules) ----
    if (!isEmail(email)) return fail(res, 'Please enter a valid email address', 422);
    if (!isUsername(username)) {
      return fail(res, 'Username must be 3–20 characters: letters, numbers or underscores', 422);
    }
    if (!isNonEmptyString(displayName)) return fail(res, 'Display name is required', 422);
    if (!isValidPassword(password)) {
      return fail(res, 'Password must be at least 8 characters', 422);
    }

    // ---- uniqueness (specific errors so the UI can point at the right field) ----
    if (await User.exists({ email })) {
      return fail(res, 'Email already registered', 409);
    }
    if (await User.exists({ username: ciExact(username) })) {
      return fail(res, 'Username taken', 409);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({ email, username, displayName, passwordHash });

    const token = signToken({ userId: user.id, username: user.username, email: user.email });
    // toJSON strips passwordHash — the raw hash never reaches the client.
    return ok(res, { token, user: user.toJSON() }, 201);
  } catch (err) {
    // Fallback for the unique-index race two requests can slip through above.
    if (isDuplicateKeyError(err)) {
      const field = duplicateField(err);
      if (field === 'email') return fail(res, 'Email already registered', 409);
      if (field === 'username') return fail(res, 'Username taken', 409);
      return fail(res, 'Account already exists', 409);
    }
    console.error('register error:', err);
    return fail(res, 'Something went wrong creating your account', 500);
  }
}

/* -------------------------------- login ---------------------------------- */

export async function login(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      // Same generic message — don't reveal which field is empty/wrong.
      return fail(res, 'Invalid email or password', 401);
    }

    // passwordHash is select:false, so pull it in explicitly for the compare.
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) return fail(res, 'Invalid email or password', 401);

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return fail(res, 'Invalid email or password', 401);

    const token = signToken({ userId: user.id, username: user.username, email: user.email });
    return ok(res, { token, user: user.toJSON() });
  } catch (err) {
    console.error('login error:', err);
    return fail(res, 'Something went wrong signing you in', 500);
  }
}

/* --------------------------------- me ------------------------------------ */

export async function me(req: Request, res: Response): Promise<Response> {
  try {
    // requireAuth guarantees req.user is set before this runs.
    const user = await User.findById(req.user!.userId);
    if (!user) return fail(res, 'User not found', 404);
    return ok(res, { user: user.toJSON() });
  } catch (err) {
    console.error('me error:', err);
    return fail(res, 'Something went wrong loading your profile', 500);
  }
}

/* ------------------------------- logout ---------------------------------- */

/**
 * Logout is a client-side token discard — the JWT is stateless, so there is no
 * server session to destroy. The endpoint exists because the spec lists it and
 * because it gives us one place to hang revocation if a denylist ever lands.
 */
export async function logout(_req: Request, res: Response): Promise<Response> {
  return ok(res, { ok: true });
}

/* --------------------------- username availability ----------------------- */

/**
 * Backs the live "@handle" check in onboarding step 2. Public, because the user
 * doesn't have an account yet when they need it.
 *
 * Returns `available: false` with a reason for malformed handles too, so the UI
 * has one source of truth for the message under the field.
 */
export async function checkUsername(req: Request, res: Response): Promise<Response> {
  try {
    const username = str(req.query.username);
    if (!username) return fail(res, 'Provide a username to check', 422);

    if (!isUsername(username)) {
      return ok(res, {
        available: false,
        reason: 'Username must be 3–20 characters: letters, numbers or underscores',
      });
    }

    const taken = await User.exists({ username: ciExact(username) });
    return ok(res, {
      available: !taken,
      reason: taken ? 'That handle is already taken' : null,
    });
  } catch (err) {
    console.error('checkUsername error:', err);
    return fail(res, 'Could not check that handle', 500);
  }
}

/* ---------------------------- onboarding status --------------------------- */

export async function onboardingStatus(req: Request, res: Response): Promise<Response> {
  try {
    const user = await User.findById(req.user!.userId).select(
      'onboardingCompleted age gender favouriteGenres favouriteMood profilePhoto',
    );
    if (!user) return fail(res, 'User not found', 404);

    return ok(res, {
      onboardingCompleted: user.onboardingCompleted,
      // Which steps already have answers, so a resumed flow can skip ahead.
      progress: {
        about: Boolean(user.age && user.gender),
        taste: user.favouriteGenres.length >= MIN_GENRES && Boolean(user.favouriteMood),
        photo: Boolean(user.profilePhoto),
      },
    });
  } catch (err) {
    console.error('onboardingStatus error:', err);
    return fail(res, 'Could not load your onboarding status', 500);
  }
}

/* --------------------------- complete onboarding -------------------------- */

/**
 * Saves steps 3 and 4 (age, gender, genres, mood) and flips the completion
 * flag. The photo step writes through PUT /api/users/me instead, since it's the
 * same operation as changing your avatar later.
 *
 * Validation mirrors the form: age ≥ 13, a known gender, at least three genres,
 * a known mood.
 */
export async function completeOnboarding(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const age = typeof body.age === 'string' ? Number(body.age) : body.age;
    if (!isValidAge(age)) return fail(res, 'You must be at least 13 to use Velvet', 422);

    if (!isGender(body.gender)) return fail(res, 'Please choose one of the gender options', 422);

    const favouriteGenres = cleanGenres(body.favouriteGenres);
    if (favouriteGenres.length < MIN_GENRES) {
      return fail(res, `Pick at least ${MIN_GENRES} genres you love`, 422);
    }

    if (!isMood(body.favouriteMood)) return fail(res, 'Please choose a favourite mood', 422);

    const user = await User.findByIdAndUpdate(
      req.user!.userId,
      {
        age,
        gender: body.gender,
        favouriteGenres,
        favouriteMood: body.favouriteMood,
        onboardingCompleted: true,
      },
      { new: true, runValidators: true },
    );
    if (!user) return fail(res, 'User not found', 404);

    return ok(res, { user: user.toJSON() });
  } catch (err) {
    console.error('completeOnboarding error:', err);
    return fail(res, 'Could not save your profile', 500);
  }
}

/* ------------------------------- helpers --------------------------------- */

function isDuplicateKeyError(
  err: unknown,
): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

function duplicateField(err: { keyPattern?: Record<string, unknown> }): string | null {
  const keys = err.keyPattern ? Object.keys(err.keyPattern) : [];
  return keys[0] ?? null;
}
