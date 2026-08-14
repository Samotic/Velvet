import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Request, Response } from 'express';

import { configured, env } from '../config/env';
import { User } from '../models/User';
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
} from '../services/email';
import * as google from '../services/google';
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

/* ----------------------------- credential tokens -------------------------- */

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TTL_MS = 60 * 60 * 1000; //  1 hour

/**
 * Mints a one-time credential token.
 *
 * The raw value goes in the email; only its SHA-256 is stored. A token is a
 * bearer credential — anyone holding the stored value could take the account
 * over — so a leaked database dump must not be enough to do that. Hashing is
 * unsalted and fast on purpose: the input is 32 bytes of CSPRNG output, not a
 * guessable password, so there is nothing for a slow KDF to protect against.
 */
function mintToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Issues a fresh verification token, stores its hash, and emails the link. */
async function issueVerification(user: {
  id: string;
  email: string;
  displayName: string;
}): Promise<boolean> {
  const { raw, hash } = mintToken();
  await User.updateOne(
    { _id: user.id },
    {
      $set: {
        emailVerificationToken: hash,
        emailVerificationExpires: new Date(Date.now() + VERIFY_TTL_MS),
      },
    },
  );
  return sendVerificationEmail({ to: user.email, displayName: user.displayName, token: raw });
}

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
    if (!isValidPassword(password)) {
      return fail(res, 'Password must be at least 8 characters', 422);
    }

    /**
     * Username and display name are **optional here**.
     *
     * /signup asks only for an email and a password; the handle and name are
     * step 1 of onboarding. The schema still requires a username, so one is
     * derived from the address — the same helper the Google flow uses. The user
     * replaces it moments later, and `onboardingCompleted` stays false until
     * they do, so the middleware gate will not let them into the app with a
     * machine-generated handle.
     *
     * They are still accepted when supplied, so an API client can create a fully
     * formed account in one call.
     */
    if (username && !isUsername(username)) {
      return fail(res, 'Username must be 3–20 characters: letters, numbers or underscores', 422);
    }

    // ---- uniqueness (specific errors so the UI can point at the right field) ----
    if (await User.exists({ email })) {
      return fail(res, 'Email already registered', 409);
    }
    if (username && (await User.exists({ username: ciExact(username) }))) {
      return fail(res, 'Username taken', 409);
    }

    const finalUsername = username || (await uniqueUsernameFrom(email, displayName));
    const finalDisplayName = isNonEmptyString(displayName)
      ? displayName
      : // A readable placeholder beats an empty heading while they finish setup.
        email.split('@')[0];

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({
      email,
      username: finalUsername,
      displayName: finalDisplayName,
      passwordHash,
      authProvider: 'local',
      emailVerified: false,
      // A new account is never onboarded, even when this call supplied a name
      // and handle. Onboarding is a client flow with two further steps; the
      // server inferring completion from a registration payload would let an
      // account into the app having seen none of it.
      onboardingCompleted: false,
      onboardingStep: 0,
    });

    // Fire the verification email but do not make the signup depend on it: the
    // account exists either way, and an unverified user can still browse and
    // finish onboarding. `issueVerification` never throws.
    await issueVerification({ id: user.id, email: user.email, displayName: user.displayName });

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

    // A Google-only account has no password to compare. Say so plainly rather
    // than "invalid password" — the address genuinely has an account, and the
    // generic message would send the user round in circles. This leaks only
    // which provider an address uses, which the Google button reveals anyway.
    if (!user.passwordHash) {
      return fail(res, 'This account uses Google. Use “Continue with Google” to sign in.', 409);
    }

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
    // 401, not 404. The token's signature is valid but the account behind it is
    // gone (deleted by hand, or dropped with the database) — that is a dead
    // session, not a missing resource. Only a 401 trips the global teardown in
    // lib/api.ts, which clears the token and the velvet.session cookie. On a 404
    // both survive, middleware keeps reading a session, and the user is pinned
    // to /onboarding/profile with no route back to /signin.
    if (!user) return fail(res, 'Session no longer valid', 401);
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

/* ---------------------------- onboarding steps ---------------------------- */

/**
 * POST /api/auth/onboarding/profile  { displayName, username }
 *
 * Step 1, and the only required one: it is what flips `onboardingCompleted`,
 * which is the flag the middleware gate reads. Until this succeeds the account
 * exists but cannot reach the app.
 */
export async function onboardingProfile(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const displayName = str(body.displayName).trim();
    const username = str(body.username).trim();

    if (!isNonEmptyString(displayName)) return fail(res, 'Display name is required', 422);
    if (!isUsername(username)) {
      return fail(res, 'Username must be 3–20 characters: letters, numbers or underscores', 422);
    }

    // Anyone but this user holding the handle is a conflict.
    const clash = await User.findOne({ username: ciExact(username) }).select('_id').lean();
    if (clash && String(clash._id) !== req.user!.userId) {
      return fail(res, 'Username taken', 409);
    }

    const user = await User.findByIdAndUpdate(
      req.user!.userId,
      {
        displayName,
        username,
        onboardingCompleted: true,
        // Never move the marker backwards — someone editing step 1 after
        // reaching step 3 must not be sent round the flow again.
        $max: { onboardingStep: 1 },
      },
      { new: true, runValidators: true },
    );
    if (!user) return fail(res, 'User not found', 404);

    // The handle is in the JWT, so a changed username needs a fresh token or
    // every later request would carry a stale one.
    const token = signToken({ userId: user.id, username: user.username, email: user.email });
    return ok(res, { token, user: user.toJSON() });
  } catch (err) {
    if (isDuplicateKeyError(err)) return fail(res, 'Username taken', 409);
    console.error('onboardingProfile error:', err);
    return fail(res, 'Could not save your profile', 500);
  }
}

/**
 * POST /api/auth/onboarding/step  { step }
 *
 * Records progress through the two skippable steps so a closed tab resumes
 * where it left off. Deliberately monotonic — skipping still advances, because
 * "I chose not to add a photo" is progress, not an absence of it.
 */
export async function onboardingStep(req: Request, res: Response): Promise<Response> {
  try {
    const step = Number((req.body ?? {}).step);
    if (!Number.isInteger(step) || step < 0 || step > 3) {
      return fail(res, 'Unknown onboarding step', 422);
    }

    const user = await User.findByIdAndUpdate(
      req.user!.userId,
      { $max: { onboardingStep: step } },
      { new: true },
    );
    if (!user) return fail(res, 'User not found', 404);

    return ok(res, { user: user.toJSON() });
  } catch (err) {
    console.error('onboardingStep error:', err);
    return fail(res, 'Could not save your progress', 500);
  }
}

/* --------------------------- email verification --------------------------- */

/**
 * POST /api/auth/verify-email  { token }
 *
 * Public: the link is opened from an inbox, which may not be the browser the
 * account is signed in on. The token is the credential.
 */
export async function verifyEmail(req: Request, res: Response): Promise<Response> {
  try {
    const token = str((req.body ?? {}).token);
    if (!token) return fail(res, 'That verification link is incomplete', 422);

    const user = await User.findOne({
      emailVerificationToken: hashToken(token),
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      // Covers "never existed", "already used" and "expired" with one message —
      // the user's next step is the same in all three: ask for a new link.
      return fail(res, 'That link has expired or already been used. Request a new one.', 400);
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    // Best-effort, and only ever once: the token is cleared above, so a second
    // open of the same link cannot reach this line.
    await sendWelcomeEmail({
      to: user.email,
      displayName: user.displayName,
      favouriteGenres: user.favouriteGenres ?? [],
      favouriteMood: user.favouriteMood ?? null,
    });

    return ok(res, { user: user.toJSON() });
  } catch (err) {
    console.error('verifyEmail error:', err);
    return fail(res, 'Could not verify that link', 500);
  }
}

/**
 * POST /api/auth/resend-verification
 *
 * Authenticated, deliberately: an open endpoint that emails any address on
 * request is a spam relay pointed at strangers. Registration signs the user in,
 * so the "check your inbox" screen always has a token to send this with.
 */
export async function resendVerification(req: Request, res: Response): Promise<Response> {
  try {
    const user = await User.findById(req.user!.userId);
    if (!user) return fail(res, 'User not found', 404);
    if (user.emailVerified) return ok(res, { sent: false, alreadyVerified: true });

    const sent = await issueVerification({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    });

    if (!sent && !configured.email()) {
      return fail(res, 'Email is not configured on this server yet', 503);
    }
    if (!sent) return fail(res, 'Could not send that email just now', 502);

    return ok(res, { sent: true, alreadyVerified: false });
  } catch (err) {
    console.error('resendVerification error:', err);
    return fail(res, 'Could not resend that email', 500);
  }
}

/* ----------------------------- password reset ----------------------------- */

/**
 * POST /api/auth/forgot-password  { email }
 *
 * Always answers 200, whether or not the address has an account. Anything else
 * turns this into an oracle for which emails are registered.
 */
export async function forgotPassword(req: Request, res: Response): Promise<Response> {
  const generic = { sent: true } as const;

  try {
    const email = str((req.body ?? {}).email).trim().toLowerCase();
    if (!isEmail(email)) return fail(res, 'Please enter a valid email address', 422);

    const user = await User.findOne({ email });

    // No account, or a Google account with no password to reset — say nothing.
    // A document written before `authProvider` existed reads back undefined;
    // that is a legacy local account, so only an explicit 'google' is excluded.
    if (!user || user.authProvider === 'google') return ok(res, generic);

    const { raw, hash } = mintToken();
    await User.updateOne(
      { _id: user.id },
      {
        $set: {
          passwordResetToken: hash,
          passwordResetExpires: new Date(Date.now() + RESET_TTL_MS),
        },
      },
    );

    await sendPasswordResetEmail({
      to: user.email,
      displayName: user.displayName,
      token: raw,
    });

    return ok(res, generic);
  } catch (err) {
    console.error('forgotPassword error:', err);
    // Still generic — an error here must not distinguish itself from success.
    return ok(res, generic);
  }
}

/** POST /api/auth/reset-password  { token, newPassword } */
export async function resetPassword(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = str(body.token);
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!token) return fail(res, 'That reset link is incomplete', 422);
    if (!isValidPassword(newPassword)) {
      return fail(res, 'Password must be at least 8 characters', 422);
    }

    const user = await User.findOne({
      passwordResetToken: hashToken(token),
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      return fail(res, 'That link has expired or already been used. Request a new one.', 400);
    }

    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    // Reaching the inbox proves the address, so a reset doubles as verification.
    user.emailVerified = true;
    await user.save();

    // Sign them straight in — they have just proved control of the account, and
    // bouncing them to a login form to retype the password they chose 4 seconds
    // ago is friction for its own sake.
    const authToken = signToken({
      userId: user.id,
      username: user.username,
      email: user.email,
    });
    return ok(res, { token: authToken, user: user.toJSON() });
  } catch (err) {
    console.error('resetPassword error:', err);
    return fail(res, 'Could not reset that password', 500);
  }
}

/* ------------------------------ google oauth ------------------------------ */

/**
 * GET /api/auth/google
 *
 * Bounces the browser to Google's consent screen. A redirect rather than a JSON
 * URL because the button is a plain link — no popup, no client-side SDK, and it
 * works with JavaScript half-loaded.
 */
export function googleStart(req: Request, res: Response): void {
  if (!configured.google()) {
    res.redirect(`${env.frontendUrl}/signin?error=google_unavailable`);
    return;
  }
  // `next` lets a deep link come back to where it started.
  const next = str(req.query.next) || undefined;
  res.redirect(google.authUrl(google.signState(next)));
}

/**
 * GET /api/auth/google/callback
 *
 * Google returns the user here with `?code&state`. Everything ends in a redirect
 * back to the frontend — the user is mid-navigation in a browser, so a JSON
 * error body would be a dead end. Success carries the Velvet JWT in the query
 * for `/auth/callback` to store; failure carries a reason for /login to show.
 */
export async function googleCallback(req: Request, res: Response): Promise<void> {
  const bounce = (path: string) => res.redirect(`${env.frontendUrl}${path}`);

  try {
    if (!configured.google()) return bounce('/signin?error=google_unavailable');

    // Google reports a declined consent screen as ?error=access_denied.
    if (str(req.query.error)) return bounce('/signin?error=google_denied');

    const code = str(req.query.code);
    const state = verifyStateOrNull(str(req.query.state));
    if (!code) return bounce('/signin?error=google_failed');
    if (!state) return bounce('/signin?error=google_state');

    const profile = await google.exchangeCode(code);

    // Google will not vouch for the address — refuse rather than trust it, since
    // an unverified Google address could belong to someone else entirely.
    if (!profile.emailVerified) return bounce('/signin?error=google_unverified');

    const user = await findOrCreateGoogleUser(profile);

    const token = signToken({
      userId: user.id,
      username: user.username,
      email: user.email,
    });

    const next = state.next && state.next.startsWith('/') ? state.next : '';
    const params = new URLSearchParams({ token });
    if (next) params.set('next', next);
    if (!user.onboardingCompleted) params.set('onboarding', '1');

    return bounce(`/auth/callback?${params.toString()}`);
  } catch (err) {
    console.error('google callback error:', err);
    return bounce('/signin?error=google_failed');
  }
}

const verifyStateOrNull = (state: string) => (state ? google.verifyState(state) : null);

/**
 * Resolves a Google profile to a Velvet account, creating one if needed.
 *
 * Three cases, in order:
 *  1. Known googleId          → sign in.
 *  2. Known email             → link the googleId to that account and sign in,
 *                               which is what the spec asks for. `authProvider`
 *                               keeps recording how the account was *created*,
 *                               so a local account that links Google can still
 *                               use its password.
 *  3. Neither                 → create, verified, with a derived handle.
 */
async function findOrCreateGoogleUser(profile: google.GoogleProfile) {
  const byGoogleId = await User.findOne({ googleId: profile.googleId });
  if (byGoogleId) return byGoogleId;

  const byEmail = await User.findOne({ email: profile.email });
  if (byEmail) {
    byEmail.googleId = profile.googleId;
    // Google has vouched for the address, so any pending verification is moot.
    byEmail.emailVerified = true;
    byEmail.emailVerificationToken = null;
    byEmail.emailVerificationExpires = null;
    // Only adopt Google's photo when there isn't one already — never overwrite
    // an avatar the user uploaded themselves.
    if (!byEmail.profilePhoto && profile.picture) byEmail.profilePhoto = profile.picture;
    await byEmail.save();
    return byEmail;
  }

  return User.create({
    email: profile.email,
    username: await uniqueUsernameFrom(profile.email, profile.name),
    displayName: profile.name,
    profilePhoto: profile.picture,
    authProvider: 'google',
    googleId: profile.googleId,
    emailVerified: true,
    // No passwordHash: the schema only requires one for local accounts.
  });
}

/**
 * Derives a free handle from a Google profile.
 *
 * The email's local part is the best starting point (it is what people expect
 * their handle to be), falling back to the display name, then to a generic stem
 * if neither survives the character rules. A numeric suffix resolves collisions.
 */
async function uniqueUsernameFrom(email: string, name: string): Promise<string> {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 16);

  const stem = clean(email.split('@')[0]) || clean(name) || 'velvet';
  // The schema demands at least 3 characters.
  const base = stem.length >= 3 ? stem : `${stem}user`.slice(0, 16);

  if (!(await User.exists({ username: ciExact(base) }))) return base;

  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${base.slice(0, 20 - String(i).length)}${i}`;
    if (!(await User.exists({ username: ciExact(candidate) }))) return candidate;
  }

  // Vanishingly unlikely; a random tail is still better than throwing.
  return `${base.slice(0, 12)}${crypto.randomBytes(3).toString('hex')}`;
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
