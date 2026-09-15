/**
 * Every edit has a name in the undo history, in both languages.
 *
 * The undo labels are read by key at dispatch time (`command.<key>`), and a
 * missing key renders as itself. Eleven had never been written — every mark
 * added after the first pass (slur, fermata, hairpin, arpeggio, octave bracket,
 * glissando, ornament, fingering, barline, clef at bar, navigation) — and the
 * undo menu read "command.toggleSlur". No other test could see it: the keys
 * are built at runtime, so a source scan finds nothing to check, and locale
 * parity passes when a key is missing from both files alike.
 *
 * So the list comes from music_editing, which owns the commands, and each is
 * required here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COMMAND_LABEL_KEYS } from '@sudobility/music_lib';

function commandBlock(lang: string): Record<string, string> {
  const json = JSON.parse(readFileSync(`public/locales/${lang}/app.json`, 'utf8')) as {
    command?: Record<string, string>;
  };
  return json.command ?? {};
}

describe('undo labels', () => {
  it.each(['en', 'zh'])('name every command in %s', (lang) => {
    const block = commandBlock(lang);
    const missing = COMMAND_LABEL_KEYS.filter((key) => !block[key]?.trim());
    expect(missing).toEqual([]);
  });

  it('carry no label for a command that no longer exists', () => {
    const known = new Set<string>(COMMAND_LABEL_KEYS);
    for (const lang of ['en', 'zh']) {
      expect(Object.keys(commandBlock(lang)).filter((key) => !known.has(key))).toEqual([]);
    }
  });
});
