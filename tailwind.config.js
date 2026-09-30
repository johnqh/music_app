import { createTailwindPreset } from '@sudobility/design';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [createTailwindPreset()],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@sudobility/components/**/*.{js,jsx,ts,tsx}',
    './node_modules/@sudobility/building_blocks/**/*.{js,jsx,ts,tsx}',
    './node_modules/@sudobility/design/**/*.{js,jsx,ts,tsx}',
    './node_modules/@sudobility/auth-components/**/*.{js,jsx,ts,tsx}',
    // Every package that renders markup of its own. One that is missing here
    // still works for the classes something else happens to use, and draws
    // nothing for the rest: the coupon form's button had no background.
    './node_modules/@sudobility/consumables_pages/dist/**/*.js',
    './node_modules/@sudobility/entity_pages/dist/**/*.js',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Aliases onto the design system's own tokens, kept for the shared
        // packages that write `theme-*` in their own markup
        // (`@sudobility/components`, `@sudobility/building_blocks`); nothing
        // in this app's source uses them. They used to read
        // `var(--color-text-secondary)` and the like, which nothing ever
        // defined: `generateThemeCSS` injects `--muted-foreground`,
        // `--border` and so on. Every `theme-*` class therefore compiled to
        // an undefined variable and drew nothing — secondary text came out
        // in the full foreground colour, borders in `currentColor`, hover
        // and surface backgrounds transparent. New code uses the semantic
        // classes directly (`text-muted-foreground`, `border-border`);
        // `src/__design-tokens.test.ts` holds both halves.
        theme: {
          'bg-primary': 'hsl(var(--background) / <alpha-value>)',
          'bg-secondary': 'hsl(var(--muted) / <alpha-value>)',
          'bg-tertiary': 'hsl(var(--well) / <alpha-value>)',
          text: 'hsl(var(--foreground) / <alpha-value>)',
          'text-primary': 'hsl(var(--foreground) / <alpha-value>)',
          'text-secondary': 'hsl(var(--muted-foreground) / <alpha-value>)',
          'text-tertiary': 'hsl(var(--muted-foreground) / <alpha-value>)',
          border: 'hsl(var(--border) / <alpha-value>)',
          'border-light': 'hsl(var(--border) / <alpha-value>)',
          'hover-bg': 'hsl(var(--accent) / <alpha-value>)',
          'hover-border': 'hsl(var(--input) / <alpha-value>)',
          surface: 'hsl(var(--card) / <alpha-value>)',
          'surface-hover': 'hsl(var(--muted) / <alpha-value>)',
          error: 'hsl(var(--destructive) / <alpha-value>)',
          success: 'hsl(var(--success) / <alpha-value>)',
          warning: 'hsl(var(--warning) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
