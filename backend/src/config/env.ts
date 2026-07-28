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
  /** Free tier daily message allowance; Velvet Pro is unlimited. */
  aiFreeDailyMessages: Number(process.env.AI_FREE_DAILY_MESSAGES) || 10,

  /* --- uploads --- */
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? '',

  /* --- payments --- */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
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
  stripe: () => Boolean(env.stripeSecretKey),
};
