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
