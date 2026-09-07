/**
 * Fail the build, not the visitor.
 *
 * `NEXT_PUBLIC_API_URL` is inlined at build time and falls back to
 * `http://localhost:4000` in `lib/api.ts`. A production build without it
 * therefore ships an app that asks every visitor's own machine for data —
 * every request dies at the network layer, and nothing appears in the server
 * logs because no request ever reaches the server.
 *
 * The check belongs here rather than in `lib/api.ts`: that module ships to the
 * browser, so throwing there would white-screen visitors on a mistake that
 * should have stopped the deploy. This runs on the builder, before anything is
 * published, and a failed build is the cheapest possible place to learn.
 *
 * Guarded on `NODE_ENV` so `next dev` still starts on a fresh clone with no
 * `.env` — local work falls back to localhost, which is correct there.
 */
if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    'NEXT_PUBLIC_API_URL is not set.\n\n' +
      '  A production build without it would ship an app pointing at\n' +
      '  http://localhost:4000, so every request from a visitor would fail.\n\n' +
      '  Set it in the Vercel dashboard (Project Settings -> Environment\n' +
      '  Variables) to the deployed API origin, with no trailing slash, then\n' +
      '  redeploy. It is read at build time, so a change needs a rebuild.',
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    /**
     * Every host the catalogue and profiles serve images from. next/image
     * refuses an unlisted host at request time, so a missing entry here shows
     * up as broken art rather than a build error — IGDB and Cloudinary are as
     * required as TMDB.
     */
    remotePatterns: [
      { protocol: 'https', hostname: 'image.tmdb.org', pathname: '/t/p/**' },
      { protocol: 'https', hostname: 'images.igdb.com', pathname: '/igdb/image/**' },
      { protocol: 'https', hostname: 'res.cloudinary.com', pathname: '/**' },
      /**
       * Google account avatars. A Google sign-in stores the `picture` from the
       * profile as-is, so the first thing a Google user sees is their own
       * avatar — and an unlisted host throws at render rather than degrading.
       *
       * Wildcarded because Google shards these across lh3…lh6 and picks per
       * account; pinning lh3 alone would work until it didn't.
       */
      { protocol: 'https', hostname: '**.googleusercontent.com', pathname: '/**' },
    ],
    /* Posters are the page's weight. AVIF roughly halves them against WebP,
       and the optimiser falls back per browser support. */
    formats: ['image/avif', 'image/webp'],
    /* Catalogue art is immutable — a TMDB poster path never changes content.
       Hold the optimised copies for a month instead of the 60s default. */
    minimumCacheTTL: 2678400,
  },
};

export default nextConfig;
