/**
 * Colour comes from the design system's tokens, and from nowhere else.
 *
 * Two failures, both invisible to every other test here, because jsdom
 * resolves no CSS variables and computes no colours:
 *
 * - **A class whose variable nothing defines draws nothing.** This app's
 *   `theme-*` colours read `var(--color-text-secondary)` and its siblings,
 *   and the design system injects `--muted-foreground`, `--border` and so on
 *   — so all 190-odd uses compiled to a rule with no value. Secondary text
 *   came out in the full foreground colour, every border in `currentColor`,
 *   every hover and surface background transparent. `bg-theme-primary
 *   text-white` on the API keys page was the visible end of it: white text
 *   on no background at all. Measured in a browser, not inferred —
 *   `text-theme-text-secondary` computed to `rgb(0, 0, 0)` beside
 *   `text-muted-foreground` at `rgb(109, 109, 109)`.
 * - **A palette class does not follow the theme.** `bg-red-600 text-white`
 *   is one red in both themes and the wrong red in each: the theme's
 *   destructive colour gets lighter in the dark and its declared foreground
 *   there is black. `bg-destructive text-destructive-foreground` is the pair.
 *
 * Comments are stripped before scanning, since several files explain in prose
 * exactly which class they do not use.
 */
import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import resolveConfig from 'tailwindcss/resolveConfig';
import { generateThemeCSS, swissTheme } from '@sudobility/design/themes';

/**
 * Palette classes that are meant, by file, each with why.
 *
 * An entry is a decision that a surface must NOT follow the theme. Anything
 * else is a colour somebody reached for because it was to hand.
 */
const ALLOWED_PALETTE: Readonly<Record<string, { classes: readonly string[]; why: string }>> = {
  'src/features/print/PrintView.tsx': {
    classes: ['bg-white', 'text-black', 'text-neutral-600'],
    why: 'Paper. The page under the control bar prints black on white in either theme.',
  },
  'src/pages/ResourcesPage.tsx': {
    classes: ['bg-white', 'ring-black/10', 'text-neutral-500'],
    why: "Other sites' logos sit on one light chip in both themes; many are solid black on transparent and vanish on a dark surface.",
  },
};

/**
 * Files still allowed the `theme-*` aliases: none.
 *
 * The aliases in `tailwind.config.js` stay all the same, because
 * `@sudobility/components` and `@sudobility/building_blocks` write
 * `bg-theme-bg-primary` in their own markup and would draw nothing without
 * them. This app's source says what it means in the design system's words.
 */
const ALLOWED_THEME_ALIAS_FILES: readonly string[] = [];

const COLOUR_UTILITIES =
  'bg|text|border|ring|ring-offset|divide|outline|fill|stroke|from|to|via|placeholder|accent|caret|decoration|shadow';

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:${COLOUR_UTILITIES})-(?:white|black|(?:${PALETTE})-\\d{2,3})(?:/\\d+)?(?![\\w-])`,
  'g',
);

const THEME_CLASS = new RegExp(`(?<![\\w-])(?:${COLOUR_UTILITIES})-theme-([a-z-]+)`, 'g');

/** Source with its comments removed: prose about a class is not a use of it. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function sources(): string[] {
  return globSync('src/**/*.{ts,tsx}')
    .map((file) => file.split('\\').join('/'))
    .filter((file) => !file.includes('.test.') && !file.startsWith('src/test/'));
}

type Colours = { [name: string]: string | Colours };

async function resolvedColours(): Promise<Colours> {
  const url = pathToFileURL(resolve(process.cwd(), 'tailwind.config.js')).href;
  const config = ((await import(/* @vite-ignore */ url)) as { default: object }).default;
  return (resolveConfig(config as never) as unknown as { theme: { colors: Colours } }).theme.colors;
}

function flatten(colours: Colours, prefix = ''): Array<[string, string]> {
  return Object.entries(colours).flatMap(([name, value]) => {
    const key = name === 'DEFAULT' ? prefix.slice(0, -1) : `${prefix}${name}`;
    return typeof value === 'string'
      ? [[key, value] as [string, string]]
      : flatten(value, `${key}-`);
  });
}

describe('design tokens', () => {
  it('uses no palette colour outside the written exceptions', () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const allowed = ALLOWED_PALETTE[file]?.classes ?? [];
      for (const match of code(file).matchAll(PALETTE_CLASS)) {
        if (!allowed.includes(match[0])) offenders.push(`${match[0]} in ${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every written exception in use', () => {
    // An exception for a class that is gone is permission nobody is using,
    // waiting for the next palette class to land in that file unnoticed.
    const stale: string[] = [];
    for (const [file, { classes }] of Object.entries(ALLOWED_PALETTE)) {
      const found = new Set([...code(file).matchAll(PALETTE_CLASS)].map((match) => match[0]));
      for (const name of classes) if (!found.has(name)) stale.push(`${name} in ${file}`);
    }
    expect(stale).toEqual([]);
  });

  it('writes theme-* only where the aliases are still owed', () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      if (ALLOWED_THEME_ALIAS_FILES.includes(file)) continue;
      for (const match of code(file).matchAll(THEME_CLASS)) {
        offenders.push(`${match[0]} in ${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('defines every theme-* class that is written', async () => {
    const theme = (await resolvedColours()).theme;
    const defined = new Set(flatten(typeof theme === 'string' ? {} : theme).map(([name]) => name));
    expect(defined.size).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of sources()) {
      for (const match of code(file).matchAll(THEME_CLASS)) {
        if (!defined.has(match[1])) offenders.push(`${match[0]} in ${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('points every colour at a variable the theme injects, in both modes', async () => {
    const css = generateThemeCSS(swissTheme);
    const dark = css.indexOf('.dark');
    expect(dark).toBeGreaterThan(0);
    const light = css.slice(0, dark);
    const rest = css.slice(dark);

    const offenders: string[] = [];
    let checked = 0;
    for (const [name, value] of flatten(await resolvedColours())) {
      for (const match of value.matchAll(/var\((--[\w-]+)/g)) {
        checked += 1;
        const declaration = `${match[1]}:`;
        if (!light.includes(declaration) || !rest.includes(declaration)) {
          offenders.push(`${name} reads ${match[1]}, which the theme never sets`);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});
