/**
 * The two locales must stay the same shape, and zh must actually be Chinese.
 *
 * A missing key falls back to the English string, which looks like a working
 * app right up until a reader hits it — so nothing fails and nobody notices.
 * That is how 42 strings ended up shipping untranslated: the MusicXML warnings
 * and every project template were English in the Chinese build.
 *
 * The second check is the one that catches it. Key parity alone passes happily
 * when a translator copies the English across as a placeholder.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function load(lang: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `public/locales/${lang}/app.json`), 'utf8'),
  );
}

function flatten(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      flatten(v, path ? `${path}.${k}` : k),
    );
  }
  return [];
}

const en = flatten(load('en'));
const zh = flatten(load('zh'));

/**
 * Strings that are the same in both languages on purpose.
 *
 * Proper nouns and format names — a Chinese reader looking for the MIDI import
 * is looking for the word "MIDI" — plus a value that is pure interpolation.
 */
const SHARED_BY_DESIGN = new Set([
  'appName',
  'editor.midi',
  'editor.musicXml',
  'history.sourceApple',
  'history.sourceGoogle',
]);

const CJK = /[一-鿿]/;

describe('locale parity', () => {
  it('reads a non-trivial number of strings', () => {
    // Guards the loader: an empty parse would make everything below vacuous.
    expect(en.length).toBeGreaterThan(100);
  });

  it('defines exactly the same keys in both locales', () => {
    const enKeys = new Set(en.map(([k]) => k));
    const zhKeys = new Set(zh.map(([k]) => k));
    expect(
      [...enKeys].filter((k) => !zhKeys.has(k)),
      'keys present in en but missing from zh (these silently fall back to English)',
    ).toEqual([]);
    expect(
      [...zhKeys].filter((k) => !enKeys.has(k)),
      'orphaned zh keys',
    ).toEqual([]);
  });

  it('has actual Chinese in every zh string that is not shared by design', () => {
    const untranslated = zh
      .filter(([key]) => !SHARED_BY_DESIGN.has(key))
      // A value with no CJK and no real word is fine (punctuation, a number).
      .filter(([, value]) => !CJK.test(value) && /[A-Za-z]{3}/.test(value))
      .map(([key, value]) => `${key} = ${value}`);

    expect(
      untranslated,
      'zh strings still in English. Translate them, or add the key to ' +
        'SHARED_BY_DESIGN if it is a proper noun that should not be translated.',
    ).toEqual([]);
  });
});
