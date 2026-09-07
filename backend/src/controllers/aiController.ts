import type { Request, Response } from 'express';

import { env } from '../config/env';
import { AIChatMessage } from '../models/AIChatMessage';
import { Rating } from '../models/Rating';
import { User } from '../models/User';
import {
  AiBlockedError,
  AiNotConfiguredError,
  askAdvisor,
  extractTitles,
  followUps,
  supportsVoice,
  transcribe,
  type TasteProfile,
} from '../lib/ai';
import { isValidAudioDataUrl, stripMimeParams } from '../services/cloudinary';
import * as tmdb from '../services/tmdb';
import { recentTitles, topRatedTitles, userStats } from '../services/stats';
import { fail, ok } from '../utils/http';
import { clean, str } from '../utils/validation';

/**
 * The AI advisor.
 *
 * One user message costs one model call, which is what the daily quota counts.
 * Follow-up chips are derived locally for the same reason.
 */

/** Same ceiling a typed question gets, applied to a transcript too. */
const MAX_ADVISOR_MESSAGE = 2000;

/** How many prior turns to replay as context. */
const HISTORY_TURNS = 10;

/* -------------------------------- quota ---------------------------------- */

interface QuotaState {
  allowed: boolean;
  /** Remaining messages after this one; null when uncapped. */
  remaining: number | null;
}

/**
 * Checks and consumes one message from the daily allowance.
 *
 * The counter resets lazily on first use of a new day rather than on a cron:
 * a scheduled job would have to run in every deployment, and the reset only
 * matters at the moment someone asks.
 */
async function consumeQuota(userId: string): Promise<QuotaState> {
  const user = await User.findById(userId).select('isPro aiMessagesUsedToday aiMessagesResetAt');
  if (!user) return { allowed: false, remaining: 0 };

  // `isPro` is no longer purchasable — it is a flag set by hand on the account
  // to lift the cap for the operator or a trusted user.
  if (user.isPro) return { allowed: true, remaining: null };

  const today = new Date().toISOString().slice(0, 10);
  const resetDay = new Date(user.aiMessagesResetAt ?? 0).toISOString().slice(0, 10);
  const used = resetDay === today ? user.aiMessagesUsedToday : 0;

  if (used >= env.aiFreeDailyMessages) return { allowed: false, remaining: 0 };

  await User.updateOne(
    { _id: userId },
    { $set: { aiMessagesUsedToday: used + 1, aiMessagesResetAt: new Date() } },
  );

  return { allowed: true, remaining: Math.max(0, env.aiFreeDailyMessages - (used + 1)) };
}

/* ------------------------------- profile --------------------------------- */

/** Assembles everything the system prompt interpolates about this person. */
async function tasteProfile(userId: string): Promise<TasteProfile | null> {
  const user = await User.findById(userId).lean();
  if (!user) return null;

  const [stats, top, recent] = await Promise.all([
    userStats(userId),
    topRatedTitles(userId, 5),
    recentTitles(userId, 10),
  ]);

  return {
    displayName: user.displayName,
    age: user.age,
    gender: user.gender,
    favouriteGenres: user.favouriteGenres ?? [],
    favouriteMood: user.favouriteMood,
    watchHistoryCount: stats.films,
    topRatedFilms: top,
    avgRating: stats.avgRating,
    recentWatches: recent,
  };
}

/* ------------------------------ title links ------------------------------ */

/**
 * Rewrites the `[[Title]]` markers the advisor emits into `[[Title|type|id]]`, so
 * the client can turn each recommendation into a link to its detail page.
 *
 * Resolution is a catalogue search per distinct title, run in parallel and
 * served from the TMDB client's cache in most cases. A title that doesn't
 * resolve is left as a bare `[[Title]]` — the client renders those as a search
 * link, which is better than a dead link to a guessed id.
 */
async function linkTitles(text: string): Promise<string> {
  const titles = extractTitles(text);
  if (!titles.length) return text;

  const resolved = await Promise.all(
    titles.map(async (title) => {
      try {
        const hits = await tmdb.search(title, 'all');
        // Prefer an exact case-insensitive title match; the first hit is a
        // reasonable fallback since TMDB orders by relevance.
        const exact = hits.find((h) => h.title.toLowerCase() === title.toLowerCase());
        const best = exact ?? hits[0];
        return best ? ([title, `${best.type}|${best.id}`] as const) : ([title, null] as const);
      } catch {
        return [title, null] as const;
      }
    }),
  );

  let out = text;
  for (const [title, suffix] of resolved) {
    if (!suffix) continue;
    // Replace every occurrence of this exact marker.
    out = out.split(`[[${title}]]`).join(`[[${title}|${suffix}]]`);
  }
  return out;
}

/* --------------------------------- chat ---------------------------------- */

/** POST /api/ai/chat */
export async function chat(req: Request, res: Response): Promise<Response> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = req.user!.userId;

    /**
     * A spoken question becomes a written one here, at the edge, and nothing
     * downstream knows the difference: history, `[[Title]]` extraction, the
     * follow-up chips and the quota all see an ordinary text turn.
     *
     * Transcribed **before** the quota is consumed, so a clip that turns out
     * to contain no speech costs the user nothing from their daily allowance.
     * It has already cost a model call, which is why the empty case returns
     * rather than falling through to a second one.
     */
    let message: string;

    if (body.kind === 'audio') {
      if (!supportsVoice) return fail(res, 'Voice messages are not available here', 400);
      if (!isValidAudioDataUrl(body.media)) return fail(res, 'That recording is not valid', 422);

      const normalised = stripMimeParams(body.media);
      const [header, data] = normalised.split(';base64,');
      const spoken = await transcribe({ data, mimeType: header.replace('data:', '') });

      // Sanitised like any other user text: it is model output about to be
      // stored and replayed, and the same rules apply to it as to typing.
      message = clean(spoken, MAX_ADVISOR_MESSAGE);
      if (!message) return fail(res, "I couldn't hear anything in that recording", 422);
    } else {
      message = clean(body.message, MAX_ADVISOR_MESSAGE);
      if (!message) return fail(res, 'Ask me something first', 422);
    }

    const profile = await tasteProfile(userId);
    if (!profile) return fail(res, 'User not found', 404);

    const quota = await consumeQuota(userId);
    if (!quota.allowed) {
      return fail(
        res,
        `That's your ${env.aiFreeDailyMessages} advisor messages for today — the count resets tomorrow.`,
        429,
      );
    }

    // The detail screen's "Ask AI" passes the title in view.
    const context = body.context as Record<string, unknown> | undefined;
    const filmContext = context?.contentTitle ? str(context.contentTitle) : undefined;

    const history = await AIChatMessage.find({ userId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_TURNS)
      .lean();

    const reply = await askAdvisor({
      profile,
      history: history.reverse().map((h) => ({ role: h.role, content: h.content })),
      message,
      filmContext,
      // Straight from the browser. "Tonight" has to mean the user's tonight,
      // and the server's own clock is a deployment detail that would put them
      // a day out for a good part of every evening.
      timeZone: str(body.timeZone),
    });

    const linked = await linkTitles(reply);
    const suggestions = followUps(reply, profile);

    // Persist both turns so the log survives a reload and the next request has
    // context. The user turn is stored first so ordering is stable.
    const asked = await AIChatMessage.create({
      userId,
      role: 'user',
      content: message,
      suggestions: [],
    });
    const saved = await AIChatMessage.create({
      userId,
      role: 'assistant',
      content: linked,
      suggestions,
    });

    /**
     * The user's turn is returned as well as the assistant's.
     *
     * A typed question is already on screen optimistically and the client
     * ignores this. A spoken one is not: nobody knows what a clip says until
     * it has been transcribed, so this is the only way the asker gets to see
     * what was actually heard — which matters most when it was heard wrong.
     */
    return ok(res, {
      message: saved.toJSON(),
      userMessage: asked.toJSON(),
      remaining: quota.remaining,
    });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) return fail(res, err.message, 503);

    // A refusal is an outcome, not a fault. Gemini's filters can fire on the
    // ordinary subject matter of a film app, and the user is owed a sentence
    // that says what happened rather than a generic failure.
    if (err instanceof AiBlockedError) {
      console.warn(`ai chat blocked (${err.reason})`);
      return fail(res, `AI_BLOCKED: ${err.message}`, 422);
    }

    console.error('ai chat error:', err);
    return fail(res, 'The advisor could not reply just now', 502);
  }
}

/** GET /api/ai/history */
export async function history(req: Request, res: Response): Promise<Response> {
  try {
    const rows = await AIChatMessage.find({ userId: req.user!.userId })
      .sort({ createdAt: 1 })
      .limit(200);
    return ok(res, { messages: rows.map((r) => r.toJSON()) });
  } catch (err) {
    console.error('ai history error:', err);
    return fail(res, 'Could not load your chat history', 500);
  }
}

/* --------------------------------- picks --------------------------------- */

/**
 * GET /api/ai/picks — the weekly rail on the home screen.
 *
 * Deliberately *not* a model call: this loads on every home render, and
 * spending a model call (and a message of the user's quota) on a page view
 * would be both slow and unfair. The picks come from the catalogue filtered by
 * the user's declared genres, with the reason drawn from why it matched.
 * Anything they've already rated is excluded.
 */
export async function picks(req: Request, res: Response): Promise<Response> {
  try {
    const userId = req.user!.userId;
    const user = await User.findById(userId).select('favouriteGenres favouriteMood').lean();
    if (!user) return fail(res, 'User not found', 404);

    const genres = user.favouriteGenres ?? [];
    if (!genres.length) return ok(res, { picks: [] });

    const rated = await Rating.find({ userId }).select('contentId contentType').lean();
    const seen = new Set(rated.map((r) => `${r.contentType}:${r.contentId}`));

    // Two genres, so the rail reflects breadth rather than one preference.
    const chosen = genres.slice(0, 2);
    const rails = await Promise.all(
      chosen.map(async (genre) => {
        const genreId = tmdb.TMDB_GENRE_IDS[genre.toLowerCase()];
        if (!genreId) return [];
        const items = await tmdb
          .discover({ type: 'movie', genreId, minScore: 6.5, sort: 'popularity.desc' })
          .catch(() => []);
        return items.map((item) => ({
          item,
          reason: `You told us you love ${genre.toLowerCase()} — this is one of the best-reviewed in that lane right now.`,
        }));
      }),
    );

    const out: { item: (typeof rails)[0][0]['item']; reason: string }[] = [];
    const used = new Set<string>();
    // Interleave the genre rails so the row alternates rather than showing all
    // of one genre then all of the other.
    for (let i = 0; out.length < 6 && i < 20; i += 1) {
      for (const rail of rails) {
        const entry = rail[i];
        if (!entry) continue;
        const key = `${entry.item.type}:${entry.item.id}`;
        if (seen.has(key) || used.has(key)) continue;
        used.add(key);
        out.push(entry);
        if (out.length >= 6) break;
      }
    }

    return ok(res, { picks: out });
  } catch (err) {
    console.error('ai picks error:', err);
    return fail(res, 'Could not load your picks', 502);
  }
}
