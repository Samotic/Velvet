import dotenv from 'dotenv';

dotenv.config();

/**
 * Central, typed access to environment. Kept in one place so nothing reads
 * process.env directly and every default is documented.
 *
 * The JWT secret has a dev fallback so the server boots locally without a
 * .env, but index.ts refuses to start in production without a real one.
 *
 * Every third-party integration degrades rather than crashes when its keys are
 * absent: the catalog routes answer 503 with a setup message, the AI advisor
 * says it isn't configured, uploads are rejected politely. That keeps the app
 * runnable with nothing but MONGODB_URI set.
 */
export const env = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET || 'velvet_dev_insecure_secret_change_me',
  jwtExpiresIn: '7d',
  mongoUri: process.env.MONGODB_URI ?? '',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  /**
   * This API's own public origin. Google redirects the browser back here after
   * consent, so it must match the redirect URI registered in Google Cloud
   * Console exactly — including scheme, port and the absence of a trailing
   * slash. Behind a proxy or on a host this is the public URL, not the port
   * Express binds to.
   */
  apiUrl: (process.env.API_URL || 'http://localhost:4000').replace(/\/$/, ''),

  /**
   * Whether the deployment can run multi-document transactions, which need a
   * replica set. Atlas is one at every tier including the free M0, so this
   * defaults on; a bare `mongod` is not, and there a transaction throws
   * "Transaction numbers are only allowed on a replica set member or mongos".
   *
   * Set `SUPPORTS_TRANSACTIONS=false` on standalone Mongo. Follow writes then
   * fall back to sequential writes with compensation on failure, and drift is
   * repaired by scripts/reconcileCounters.ts.
   */
  supportsTransactions: process.env.SUPPORTS_TRANSACTIONS !== 'false',

  /* --- catalog: TMDB (films + series) --- */
  tmdbReadToken: process.env.TMDB_READ_TOKEN ?? '',
  tmdbApiKey: process.env.TMDB_API_KEY ?? '',

  /* --- catalog: IGDB (games), OAuth via Twitch --- */
  igdbClientId: process.env.IGDB_CLIENT_ID ?? '',
  igdbClientSecret: process.env.IGDB_CLIENT_SECRET ?? '',

  /* --- AI advisor --- */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  /* The spec names claude-sonnet-4-6. Overridable so the model can move
     without a code change — claude-sonnet-5 is the newer Sonnet. */
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  /**
   * Daily advisor allowance per account. Velvet is free and has no paid tier,
   * so this cap is the only thing bounding what the model costs the operator —
   * accounts with `isPro` set by hand are the sole exemption.
   */
  aiFreeDailyMessages: Number(process.env.AI_FREE_DAILY_MESSAGES) || 10,

  /* --- uploads --- */
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? '',

  /* --- sign in with Google --- */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  /**
   * The exact redirect URI sent to Google, overriding the derived default.
   *
   * Google compares this against the registered list byte for byte, and its
   * mismatch error never says what it expected — so rather than force the
   * console to match the code, this lets the code match whatever the console
   * already has. Both callback paths are served, so either spelling works.
   *
   * Leave unset and it derives from `apiUrl`.
   */
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || process.env.GOOGLE_REDIRECT_URI || '',

  /* --- transactional email --- */
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  /**
   * Resend will only deliver from a domain you have verified. Until one is set
   * up, `onboarding@resend.dev` works but can only reach the address that owns
   * the Resend account — enough to test the flow, not to sign anyone else up.
   */
  emailFrom: process.env.EMAIL_FROM || 'Velvet <onboarding@resend.dev>',
} as const;

export const isProd = env.nodeEnv === 'production';
export const isTest = env.nodeEnv === 'test';

/** Per-integration readiness, so each route can answer honestly. */
export const configured = {
  tmdb: () => Boolean(env.tmdbReadToken || env.tmdbApiKey),
  igdb: () => Boolean(env.igdbClientId && env.igdbClientSecret),
  ai: () => Boolean(env.anthropicApiKey),
  cloudinary: () =>
    Boolean(env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret),
  google: () => Boolean(env.googleClientId && env.googleClientSecret),
  email: () => Boolean(env.resendApiKey),
};
