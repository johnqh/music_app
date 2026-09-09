/**
 * Every brief the server can send has words here, in both languages.
 *
 * The presets are chosen server-side and translated host-side — the same
 * division `MusicXmlWarnings` uses, and it has the same failure: a key the
 * server serves and this app has never heard of renders as its own id, and
 * nothing fails, because a key missing from *both* locales is perfectly
 * consistent and `locale-parity` sees nothing wrong with it.
 *
 * Read from `SCORE_PRESET_KEYS` at runtime rather than from a list written out
 * here, because a check against drift that restates what it checks drifts too.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCORE_PRESET_KEYS } from '@sudobility/music_types';

function presets(lang: string): Record<string, string> {
  const json = JSON.parse(
    readFileSync(resolve(process.cwd(), `public/locales/${lang}/app.json`), 'utf8'),
  ) as { generateScore?: { preset?: Record<string, string> } };
  return json.generateScore?.preset ?? {};
}

const en = presets('en');
const zh = presets('zh');

describe('the preset briefs', () => {
  it('has an English brief for every key the server can serve', () => {
    expect([...SCORE_PRESET_KEYS].filter((key) => !en[key])).toEqual([]);
  });

  it('has a Chinese brief for every one of them, in Chinese', () => {
    // Not merely present: a translator copying the English across passes a
    // key-parity check and ships an English menu to a Chinese reader.
    for (const key of SCORE_PRESET_KEYS) {
      expect(zh[key], key).toBeTruthy();
      expect(zh[key], key).toMatch(/[一-鿿]/);
    }
  });

  it('carries no brief the server could never send', () => {
    // Copy nobody can reach is copy somebody still has to translate.
    const known = new Set<string>(SCORE_PRESET_KEYS);
    expect(Object.keys(en).filter((key) => !known.has(key))).toEqual([]);
  });

  it('never names a genre, since the style travels as its own field', () => {
    // A brief that said "reggae" would say it twice, and would be wrong the
    // moment the server assigned it to another style.
    const genres = /\b(reggae|waltz|jazz|blues|techno|disco|samba|tango|funk|punk|polka)\b/i;
    for (const [key, text] of Object.entries(en)) {
      expect(text, key).not.toMatch(genres);
    }
  });
});
