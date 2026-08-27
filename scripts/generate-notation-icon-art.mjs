/**
 * Turns the rendered notation icons into a platform-neutral data module.
 *
 * Reads `extract-notation-icons.mjs`'s output on stdin and writes the
 * `notation-icon-art.ts` that `@sudobility/music_types` publishes, so the web
 * and native apps draw the same glyphs from one description. Generated rather
 * than transcribed: the icons compute their paths from shared geometry, and
 * copying them by hand is hundreds of chances to get a number wrong.
 */
import { writeFileSync } from 'node:fs';
import { parseDocument } from 'htmlparser2';

const ATTR = {
  'fill-rule': 'fillRule',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-dasharray': 'strokeDasharray',
  'font-size': 'fontSize',
  'font-style': 'fontStyle',
  'text-anchor': 'textAnchor',
};
const NUMERIC = new Set([
  'x',
  'y',
  'width',
  'height',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'strokeWidth',
  'opacity',
  'fontSize',
]);

/** 17.4 - 3 comes out of floating point as 14.399999999999999. */
const round = (n) => Math.round(n * 1e4) / 1e4;

function shapeOf(node) {
  const kind = node.name === 'g' ? 'group' : node.name;
  const out = { kind };
  for (const [rawKey, rawValue] of Object.entries(node.attribs ?? {})) {
    const key = ATTR[rawKey] ?? rawKey;
    if (NUMERIC.has(key)) {
      const n = Number(rawValue);
      out[key] = Number.isFinite(n) ? round(n) : rawValue;
    } else {
      out[key] = rawValue;
    }
  }
  const children = (node.children ?? []).filter((c) => c.type === 'tag');
  if (kind === 'group') out.shapes = children.map(shapeOf);
  if (kind === 'text') {
    out.content = (node.children ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.data)
      .join('');
  }
  return out;
}

const raw = JSON.parse(await new Response(process.stdin).text());
const icons = {};
for (const [name, markup] of Object.entries(raw)) {
  const svg = parseDocument(markup).children.find((c) => c.name === 'svg');
  icons[name] = svg.children.filter((c) => c.type === 'tag').map(shapeOf);
}

const names = Object.keys(icons).sort();
const body = `/**
 * The notation glyphs, as data.
 *
 * **Generated — do not edit by hand.** The source of truth is
 * \`music_app/src/components/icons/notation-icons.tsx\`, rendered and serialized
 * by \`music_app/scripts/generate-notation-icon-art.mjs\`. Re-run that after
 * changing an icon.
 *
 * Here rather than in an app because two of them draw these: the web toolbar
 * and the React Native one. A second copy would drift from the first the moment
 * either was tuned, and the drift would be invisible — a glyph a pixel off is
 * not something a test notices or a reader can name.
 *
 * Data rather than components for the same reason \`icon-art.ts\` next door is:
 * this package must work on the backend and add no dependencies, so it cannot
 * hold JSX. Each app replays the shapes with its own primitives — \`<path>\` on
 * the web, \`react-native-svg\`'s \`Path\` on native.
 */

/** Every glyph is authored in a 24×24 box. */
export const NOTATION_ICON_VIEWBOX = 24;

/** A stroke cap/join, spelled as SVG spells it. */
export type NotationLineCap = 'butt' | 'round' | 'square';
export type NotationLineJoin = 'miter' | 'round' | 'bevel';

type Paint = {
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly strokeLinecap?: NotationLineCap;
  readonly strokeLinejoin?: NotationLineJoin;
  readonly strokeDasharray?: string;
  readonly opacity?: number;
  readonly transform?: string;
};

export type NotationIconShape =
  | (Paint & { readonly kind: 'path'; readonly d: string; readonly fillRule?: 'evenodd' | 'nonzero' })
  | (Paint & { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rx?: number })
  | (Paint & { readonly kind: 'ellipse'; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number })
  | (Paint & { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number })
  | (Paint & { readonly kind: 'text'; readonly x: number; readonly y: number; readonly content: string; readonly fontSize?: number; readonly fontStyle?: string; readonly textAnchor?: string })
  | (Paint & { readonly kind: 'group'; readonly shapes: readonly NotationIconShape[] });

/**
 * The closed vocabulary, as an array with the type read off it.
 *
 * A union has no runtime form, so anything that must *validate* a name would
 * otherwise write the list out again.
 */
export const NOTATION_ICON_NAMES = [
${names.map((n) => `  '${n}',`).join('\n')}
] as const;

export type NotationIconName = (typeof NOTATION_ICON_NAMES)[number];

/**
 * A record, never a parallel array: adding a name above fails to compile until
 * its shapes are supplied here, where an array would silently offer the old set.
 */
export const NOTATION_ICONS: Record<NotationIconName, readonly NotationIconShape[]> = ${JSON.stringify(icons, null, 2)} as const;
`;

writeFileSync(process.argv[2], body);
console.log(`Wrote ${names.length} icons to ${process.argv[2]}`);
