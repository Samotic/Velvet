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
      /**
       * Velvet's own Cloudinary cloud only. `res.cloudinary.com/**` accepted
       * every Cloudinary account in the world, which let anyone point the
       * optimiser at a file they host — GHSA-2xp9-vwfh-vxw4 is remote code
       * execution through an image the optimiser decodes. The cloud name is
       * public (it is in every delivered URL), so it lives here rather than in
       * an env var. Change it if the backend's CLOUDINARY_CLOUD_NAME changes.
       */
      { protocol: 'https', hostname: 'res.cloudinary.com', pathname: '/nhpamky7/**' },
      /**
       * Google account avatars. A Google sign-in stores the `picture` from the
       * profile as-is, so the first thing a Google user sees is their own
       * avatar — and an unlisted host throws at render rather than degrading.
       *
       * Profile pictures only: lh3…lh6 (Google shards avatars across them and
       * picks per account), under `/a/` and the older `/a-/`. This was
       * `**.googleusercontent.com/**`, which also covers Google-hosted user
       * content — files anyone can put there and point the optimiser at, the
       * GHSA-2xp9-vwfh-vxw4 path the Cloudinary rule above was narrowed for.
       */
      ...['lh3', 'lh4', 'lh5', 'lh6'].flatMap((host) =>
        ['/a/**', '/a-/**'].map((pathname) => ({
          protocol: 'https',
          hostname: `${host}.googleusercontent.com`,
          pathname,
        })),
      ),
    ],
    /* WebP only. AVIF was dropped for GHSA-2xp9-vwfh-vxw4 (AVIF handling in
       the libheif/sharp stack behind the optimiser), which has no fix on
       Next 14. Restore it only on a Next release that carries the patch
       (15.5.24+ / 16.3.3+). */
    formats: ['image/webp'],
    /* Catalogue art is immutable — a TMDB poster path never changes content.
       Hold the optimised copies for a month instead of the 60s default. */
    minimumCacheTTL: 2678400,
  },
};

export default nextConfig;
