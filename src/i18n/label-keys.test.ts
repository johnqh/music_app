/**
 * Every key music_types hands this app to label a vocabulary with has words in
 * both languages.
 *
 * These are the keys no scan of `t('…')` calls can see, because the key is a
 * table entry rather than a literal at the call site — and a key missing from
 * *both* locales is one `locale-parity` cannot see either, since two locales
 * agreeing that a key does not exist is perfectly consistent.
 *
 * Both tables used to be declared in this app *and* in music_app_rn, which is
 * why this test once only knew about clefs: they now come from music_types, so
 * what is left to check here is that this app's locales answer them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLEF_OPTIONS, STYLE_FAMILIES, THEME_MODE_OPTIONS } from '@sudobility/music_types';
import { styleFamilyLabelKey } from '@sudobility/music_lib';

const lookup = (strings: unknown, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      strings,
    );

const load = (lang: string): unknown =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), `public/locales/${lang}/app.json`), 'utf8'),
  ) as unknown;

describe.each(['en', 'zh'])('shared label keys (%s)', (lang) => {
  it.each([
    ['clef', CLEF_OPTIONS],
    ['theme mode', THEME_MODE_OPTIONS],
    ['style family', STYLE_FAMILIES.map((family) => ({ labelKey: styleFamilyLabelKey(family) }))],
  ])('resolve for every %s', (_what, options) => {
    const strings = load(lang);
    const missing = options
      .map((option) => option.labelKey)
      .filter((key) => typeof lookup(strings, key) !== 'string');
    expect(missing).toEqual([]);
  });
});
