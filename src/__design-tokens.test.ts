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

/**
 * Colour literals that are meant, by file, each with why.
 *
 * A hex, `rgb()` or `hsl()` value in markup or a style object is one colour in
 * both themes, which is right only for something that is not part of the
 * interface's surface — a drawing of a physical object, or a measurement.
 * `hsl(var(--token))` is not a literal and is not matched.
 */
const ALLOWED_COLOUR_LITERALS: Readonly<
  Record<string, { literals: readonly string[]; why: string }>
> = {
  'src/features/piano-keyboard/PianoKeyboardView.tsx': {
    literals: ['rgba(0,0,0,0.45)'],
    why: "The keys are a piano's: white and black in both themes (music_drawing's KEYBOARD_WHITE/BLACK), and the shadow between them is part of that drawing, not of the surface around it.",
  },
  'src/services/perf/benchmark.ts': {
    literals: [
      '#111111',
      '#777777',
      '#000000',
      '#8b5a2b',
      '#0066ff',
      '#b91c1c',
      '#666666',
      '#d32f2f',
    ],
    why: 'A render theme for the offscreen performance benchmark, which is measured and never shown.',
  },
};

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?)\(\s*[\d.][^)]*\)/g;

/**
 * Token backgrounds drawn behind nothing — a fill, a groove, a thumb — and so
 * owed no foreground. By file, each with why.
 */
const ALLOWED_UNPAIRED: Readonly<Record<string, { classes: readonly string[]; why: string }>> = {
  'src/features/tracks/mixer-controls.tsx': {
    classes: ['bg-primary'],
    why: 'The pan fill: a bar inside the slider groove with no text in it.',
  },
  'src/components/controls/level-slider.tsx': {
    classes: ['bg-primary'],
    why: 'The level fill: a bar inside the slider groove with no text in it.',
  },
  'src/components/dialogs/FileImportModal.tsx': {
    classes: ['bg-primary'],
    why: 'The progress bar fill, which holds no text.',
  },
};

/** Backgrounds with a declared foreground: the ink that is legible on them. */
const PAIRED_BACKGROUND = new RegExp(
  '(?<![\\w-])((?:[\\w-]+:)*)bg-(primary|secondary|destructive|accent|success|warning|info|foreground)(?:/(\\d+))?(?![\\w/-])',
  'g',
);

/** The class that names `token`'s foreground. */
function foregroundOf(token: string): string {
  return token === 'foreground' ? 'text-background' : `text-${token}-foreground`;
}

/** Every one-line string literal in `source`: where class lists are written. */
function stringLiterals(source: string): string[] {
  return [...source.matchAll(/(['"`])([^'"`\n]*?)\1/g)].map((match) => match[2]);
}

/** Source files that hold styling: TypeScript and stylesheets. */
function styledSources(): string[] {
  return [...sources(), ...globSync('src/**/*.css').map((file) => file.split('\\').join('/'))];
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

  it('writes no colour literal outside the written exceptions', () => {
    // The class scans above cannot see a colour that never was a class: an
    // inline `style={{ color: '#fff' }}`, an SVG `fill`, a CSS rule. Each is
    // one colour in both themes.
    const offenders: string[] = [];
    for (const file of styledSources()) {
      const allowed = ALLOWED_COLOUR_LITERALS[file]?.literals ?? [];
      for (const match of code(file).matchAll(COLOUR_LITERAL)) {
        const literal = match[0].replace(/\s+/g, '');
        if (!allowed.includes(literal)) offenders.push(`${match[0]} in ${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every colour-literal exception in use', () => {
    const stale: string[] = [];
    for (const [file, { literals }] of Object.entries(ALLOWED_COLOUR_LITERALS)) {
      const found = new Set(
        [...code(file).matchAll(COLOUR_LITERAL)].map((match) => match[0].replace(/\s+/g, '')),
      );
      for (const literal of literals) if (!found.has(literal)) stale.push(`${literal} in ${file}`);
    }
    expect(stale).toEqual([]);
  });

  it('pairs every token background with its foreground', () => {
    // `bg-accent` over inherited text is the theme's accent under whatever ink
    // the parent happened to set — and the parent may be the red title bar,
    // whose ink is black in the dark theme. The theme declares the ink for
    // each of these surfaces; a surface that sets one sets both, in the same
    // state (`hover:bg-accent hover:text-accent-foreground`). Washes under 30%
    // are tints of the surface below, which keeps its own ink, and a class on
    // a pseudo-element (`[&::-webkit-slider-thumb]:`) draws no text.
    const offenders: string[] = [];
    for (const file of sources()) {
      const allowed = ALLOWED_UNPAIRED[file]?.classes ?? [];
      for (const literal of stringLiterals(code(file))) {
        for (const [whole, modifiers, token, alpha] of literal.matchAll(PAIRED_BACKGROUND)) {
          if (alpha !== undefined && Number(alpha) < 30) continue;
          if (modifiers.includes('[&::')) continue;
          if (allowed.includes(whole)) continue;
          const ink = foregroundOf(token);
          const inked = new RegExp(
            `(?<![\\w-])(?:${modifiers.replace(/[[\]&:()]/g, '\\$&')})?${ink}(?![\\w-])`,
          );
          if (!inked.test(literal)) offenders.push(`${whole} without ${ink} in ${file}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every unpaired-background exception in use', () => {
    const stale: string[] = [];
    for (const [file, { classes }] of Object.entries(ALLOWED_UNPAIRED)) {
      const found = new Set(
        stringLiterals(code(file)).flatMap((literal) =>
          [...literal.matchAll(PAIRED_BACKGROUND)].map((match) => match[0]),
        ),
      );
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
