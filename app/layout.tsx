import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed, DM_Serif_Display, Inter } from 'next/font/google';

import { AuthProvider } from '@/components/auth/AuthProvider';
import { ToastProvider } from '@/components/Toast';

import './globals.css';

/* The three families embedded in velvet-animated.pdf, self-hosted by next/font
   so there's no render-blocking request and no layout shift. Weights are the
   ones the design actually uses — see the type scale in CLAUDE.md. */

/** UI: nav, body copy, meta, chips, labels. Light 300 → SemiBold 600. */
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

/** Editorial display: the hero title and poster fallback letters. The italic is
    load-bearing — the second word of every hero title is set in it. */
const dmSerif = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

/** Condensed numerics: the VELVET wordmark, stat figures, rank labels. */
const barlow = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '900'],
  variable: '--font-condensed',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Velvet — Rate what you watch',
  description:
    'Velvet is a movie rating app: discover films, rate them, write reviews, and track what you watch.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#07071a',
};

/**
 * Root layout: fonts, theme and providers only.
 *
 * The nav deliberately does **not** live here — it belongs to `(app)/layout.tsx`.
 * Keeping it out is what makes the auth screens genuinely full-bleed: a sign-in
 * page with a navigation bar above it is not a sign-in page.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${dmSerif.variable} ${barlow.variable}`}>
      <body>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
