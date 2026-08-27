/**
 * The shortcut list must cover the shortcuts that exist.
 *
 * It was a hand-typed copy of the bindings in `@sudobility/music_lib` and had
 * fallen six entries behind them — fermata, arpeggiate, glissando, the octave
 * bracket and both hairpins were bound, worked, and appeared in no list, so a
 * reader had no way to discover them. The bindings now publish their own keys;
 * this checks the list against them.
 */
import { describe, expect, it } from 'vitest';
import { SHIFT_MARK_KEYS } from '@sudobility/music_lib';
import { SHORTCUTS } from '@sudobility/music_editing';

describe('the shortcut list', () => {
  it('shows every mark the editor binds to Shift', () => {
    const shown = SHORTCUTS.filter((row) => row.keys?.startsWith('Shift+')).map((row) =>
      row.keys!.slice('Shift+'.length),
    );
    for (const key of SHIFT_MARK_KEYS) {
      expect(shown, `Shift+${key} is bound but not listed`).toContain(key);
    }
  });

  it('gives every row exactly one way of naming its keys', () => {
    for (const row of SHORTCUTS) {
      expect(
        Boolean(row.keys) !== Boolean(row.keysKey),
        `${row.actionKey} must have keys or keysKey, not both`,
      ).toBe(true);
    }
  });

  it('names an action for every row, and never the same one twice', () => {
    const actions = SHORTCUTS.map((r) => r.actionKey);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
