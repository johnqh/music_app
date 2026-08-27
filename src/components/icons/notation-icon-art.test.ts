/**
 * The shared glyph data must match the icons this app authors.
 *
 * `notation-icons.tsx` is the authoring form — React, with the geometry
 * computed from shared constants — and `NOTATION_ICONS` in
 * `@sudobility/music_types` is generated from it so the React Native toolbar
 * can draw the same glyphs. Two representations of one drawing will drift the
 * moment either is edited, and the drift is invisible: a sharp sign a pixel out
 * is not something a reader can name or a screenshot catches.
 *
 * So it is checked rather than trusted. Re-run
 * `bun run scripts/extract-notation-icons.mjs | bun run
 * scripts/generate-notation-icon-art.mjs <path>` after changing an icon.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NOTATION_ICONS,
  NOTATION_ICON_NAMES,
  NOTATION_ICON_VIEWBOX,
} from '@sudobility/music_types';
import type { NotationIconShape } from '@sudobility/music_types';
import * as icons from './notation-icons';

/** Re-emits a shape as the SVG element it came from, attributes in source order. */
function toMarkup(shape: NotationIconShape): string {
  const tag = shape.kind === 'group' ? 'g' : shape.kind;
  const entries: [string, unknown][] = [];
  const push = (key: string, value: unknown) => {
    if (value !== undefined) entries.push([key, value]);
  };
  const s = shape as Record<string, unknown>;
  for (const key of [
    'x',
    'y',
    'width',
    'height',
    'rx',
    'ry',
    'cx',
    'cy',
    'r',
    'd',
    'fill',
    'fillRule',
    'stroke',
    'strokeWidth',
    'strokeLinecap',
    'strokeLinejoin',
    'strokeDasharray',
    'opacity',
    'transform',
    'fontSize',
    'fontStyle',
    'textAnchor',
  ]) {
    push(key, s[key]);
  }
  const attrs = entries.map(([k, v]) => `${k}=${String(v)}`).join(' ');
  const kids =
    shape.kind === 'group'
      ? shape.shapes.map(toMarkup).join('')
      : shape.kind === 'text'
        ? shape.content
        : '';
  return `<${tag} ${attrs}>${kids}</${tag}>`;
}

/** The rendered icon, reduced to the same normalised form. */
function renderedShapes(name: string): string {
  const Icon = (icons as Record<string, unknown>)[name] as () => ReactElement;
  const markup = renderToStaticMarkup(createElement(Icon));
  return (
    markup
      .slice(markup.indexOf('>') + 1, markup.lastIndexOf('</svg>'))
      // Attribute names as the data spells them, and no quotes, so the two
      // forms are comparable without re-implementing a parser here.
      .replace(/"/g, '')
      .replace(/fill-rule=/g, 'fillRule=')
      .replace(/stroke-width=/g, 'strokeWidth=')
      .replace(/stroke-linecap=/g, 'strokeLinecap=')
      .replace(/stroke-linejoin=/g, 'strokeLinejoin=')
      .replace(/stroke-dasharray=/g, 'strokeDasharray=')
      .replace(/font-size=/g, 'fontSize=')
      .replace(/font-style=/g, 'fontStyle=')
      .replace(/text-anchor=/g, 'textAnchor=')
  );
}

describe('shared notation glyph data', () => {
  it('covers every icon this app exports', () => {
    const exported = Object.keys(icons)
      .filter((k) => /Icon$/.test(k) && typeof (icons as Record<string, unknown>)[k] === 'function')
      .sort();
    expect([...NOTATION_ICON_NAMES].sort()).toEqual(exported);
  });

  it('is authored in the same 24x24 box', () => {
    expect(NOTATION_ICON_VIEWBOX).toBe(24);
  });

  it.each([...NOTATION_ICON_NAMES])('matches the rendered %s', (name) => {
    const fromData = NOTATION_ICONS[name].map(toMarkup).join('');
    const fromComponent = renderedShapes(name);
    /*
      Compared as the multiset of numbers each contains: the two emit
      attributes in a different order, and what must not differ is the
      geometry.

      Rounded to four places, because the generator rounds — `17.4 - 3` comes
      out of floating point as `14.399999999999999`, and a stored constant that
      long is noise rather than precision.
    */
    const digits = (text: string) =>
      (text.match(/-?\d+(\.\d+)?/g) ?? [])
        .map((n) => Math.round(Number(n) * 1e4) / 1e4)
        .sort((a, b) => a - b);
    expect(digits(fromData)).toEqual(digits(fromComponent));
  });
});
