import type { Config } from 'tailwindcss';

/**
 * Tokens mirror the CSS custom properties in app/globals.css.
 *
 * globals.css is the source of truth for the monochrome indigo system; this
 * file exists so utility classes reach the same values. Keep the two in sync —
 * a colour that only lives here is a colour outside the design system.
 *
 * One hue, varied only in lightness and saturation. The three semantic colours
 * are the sole permitted exception, and they belong in status contexts only.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* --- ground: base of the pile --- */
        ink: '#07071a', // app background, deepest layer
        surface: '#0d0e2a', // cards, stat bar
        nav: '#12133a', // navbar, one step lighter than surface
        raise: '#181a48', // hover, elevated panels, inputs
        sunk: '#04040e', // deepest inset
        hero: {
          a: '#171645',
          b: '#07071a',
        },

        /* --- accent: where the light lands --- */
        accent: {
          DEFAULT: '#9691e0', // active nav, buttons, links, stars
          hi: '#cfccf5', // headline highlight, stat values
          dim: '#4c4890', // hairlines, disabled, muted icons
          mid: '#b1ade8', // derived step — hero italic, active nav
        },
        accentHi: '#cfccf5',
        accentDim: '#4c4890',

        /* --- text --- */
        text: '#e0def2', // primary copy
        mist: '#807da1', // secondary copy, labels, metadata
        mist2: '#9996b3', // derived step — secondary labels
        faint: '#55527a', // tertiary, placeholders, timestamps
        display: '#f0eefa', // headings — the brightest neutral

        /* --- structure --- */
        lineSolid: '#1e1f52',

        /* --- foreground on accent fills --- */
        onAccent: '#050516',

        /* --- semantic: status only, never decoration --- */
        success: '#5fbf95',
        warning: '#d8b45c',
        danger: '#d9707a',
      },
      fontFamily: {
        ui: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-serif)', 'DM Serif Display', 'Georgia', 'serif'],
        cond: ['var(--font-condensed)', 'Barlow Condensed', 'sans-serif'],
      },
      transitionTimingFunction: {
        velvet: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      maxWidth: {
        /* Mirrors --col in globals.css: the content column is full-bleed. */
        col: '100%',
      },
    },
  },
  plugins: [],
};

export default config;
