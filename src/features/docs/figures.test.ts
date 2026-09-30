/**
 * The figure table and the files on disk describe the same pictures.
 *
 * Neither can see the other: the table is TypeScript, the figures are PNGs
 * under `public/`, and a topic whose file was never captured renders a broken
 * image that no build step notices.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOCS_TOPIC_IDS } from '@sudobility/music_types';
import { DOCS_FIGURES, docsFigureLabelKey, docsFigureUrl } from './figures';

const DIR = resolve(process.cwd(), 'public/docs/figures');

/** A PNG states its size in the first chunk: width at byte 16, height at 20. */
function pngSize(path: string): { width: number; height: number } {
  const header = readFileSync(path).subarray(0, 24);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function lookup(bundle: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      bundle,
    );
}

const withFigure = DOCS_TOPIC_IDS.filter((id) => DOCS_FIGURES[id] !== null);

describe('documentation figures', () => {
  it('pictures the topics about the interface', () => {
    expect(withFigure.length).toBeGreaterThanOrEqual(10);
  });

  it.each(withFigure)('%s has a file of the size the table states', (id) => {
    const path = resolve(DIR, `${id}.png`);
    expect(existsSync(path), `${id}.png is missing`).toBe(true);
    const figure = DOCS_FIGURES[id]!;
    // Captured at twice the density it is drawn at.
    expect(pngSize(path)).toEqual({ width: figure.width * 2, height: figure.height * 2 });
  });

  it('has no file that no topic shows', () => {
    const files = readdirSync(DIR).filter((name) => name.endsWith('.png'));
    expect(files.sort()).toEqual(withFigure.map((id) => `${id}.png`).sort());
  });

  it.each(['en', 'zh'])('describes every figure in %s', (lang) => {
    const bundle = JSON.parse(
      readFileSync(resolve(process.cwd(), `public/locales/${lang}/app.json`), 'utf8'),
    );
    for (const id of withFigure) {
      const words = lookup(bundle, docsFigureLabelKey(id));
      expect(typeof words, docsFigureLabelKey(id)).toBe('string');
      expect((words as string).length).toBeGreaterThan(10);
    }
  });

  it('is served under the base path, whatever that is', () => {
    expect(docsFigureUrl('editor', '/')).toBe('/docs/figures/editor.png');
    expect(docsFigureUrl('editor', '/app/')).toBe('/app/docs/figures/editor.png');
  });
});
