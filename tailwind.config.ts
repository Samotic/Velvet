import type { Config } from 'tailwindcss';

/**
 * Tokens mirror the CSS custom properties in app/globals.css.
 *
 * globals.css is the source of truth for the Obsidian + Copper system; this
 * file exists so utility classes reach the same values. Keep the two in sync —
 * a colour that only lives here is a colour outside the design system.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#c8691a', // burnt copper — brand core
          bright: '#e08840',
          light: '#eaa568',
          pale: '#e8c49a', // cream
          deep: '#8f4a12',
        },
        bg: {
          DEFAULT: '#0c0a08', // warm obsidian
          raise: '#14100c',
          sunk: '#080604',
          input: '#1a1610',
        },
        white: '#f5f0ea',
        cream: '#e8c49a',
        display: '#f5f0ea',
        ink: '#e8c49a',
        muted: {
          DEFAULT: '#8a7360',
          2: '#b09578',
        },
        ok: '#4fb477',
        bad: '#e0603a',
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
        col: '1320px',
      },
    },
  },
  plugins: [],
};

export default config;
