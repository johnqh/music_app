/**
 * The vocabulary every inspector control shares.
 *
 * `MIXED` is the interesting one. A panel field can be shown a selection of
 * several notes whose values disagree, and it has to render *something* that
 * is neither a lie nor a blank — so the fields resolve to this sentinel and
 * the controls know how to draw it. `MIXED_VALUE` is its string form, because
 * a Radix select item cannot carry a symbol.
 *
 * The `*_CLASS` constants exist for the reason the toolbar's do: a select
 * trigger, an input and a label each size themselves from their own content,
 * so a column of them comes out ragged unless the height is stated once.
 */

import { ACCIDENTAL_OPTIONS } from '@sudobility/music_types';
import type { Accidental } from '@sudobility/music_types';
import { commonValue as sharedValue } from '@sudobility/music_types';

/** Sentinel distinguishing "every selected object agrees" from "differing values" (spec §20's "mixed"). */
export const MIXED = Symbol('mixed');

export type MixedOr<T> = T | typeof MIXED;

/**
 * The symbol each accidental is written with in the inspector's narrow picker.
 *
 * A record keyed by the type, not a list beside it: a sixth accidental would
 * fail to compile here rather than quietly go missing from the picker.
 *
 * The *vocabulary and its order* are music_types' — see `ACCIDENTAL_OPTIONS`,
 * re-exported below. Only the wording is this panel's, which is the split the
 * library documents: a closed vocabulary is shared, the words a surface writes
 * it in are not. This picker is one control wide in a column of controls, so it
 * writes `bb` where the native sheet, which has a whole row per entry, writes
 * "Double flat".
 */
const ACCIDENTAL_SYMBOL: Record<Accidental, string> = {
  [-2]: 'bb',
  [-1]: 'b',
  [0]: 'natural',
  [1]: '#',
  [2]: 'x',
};

/**
 * This panel's accidental picker: the library's vocabulary and order, written
 * in this panel's own symbols.
 *
 * Deliberately not named `ACCIDENTAL_OPTIONS` — music_types exports one of
 * those, and two things under one name in two packages is exactly how a picker
 * comes to offer a set the model no longer has. `__single-source.test.ts`
 * fails on that name here, which is how this was caught.
 */
export const ACCIDENTAL_PICKER: Array<{ value: Accidental; label: string }> =
  ACCIDENTAL_OPTIONS.map(({ value }) => ({
    value,
    label: ACCIDENTAL_SYMBOL[value],
  }));

export const MIXED_VALUE = '__mixed__';

/*
  Nothing else in the inspector's vocabulary is this panel's. The picker lists
  (articulations, ornaments, dynamics, barlines, key modes) and the sentinels
  that stand for an absence (no mark, a custom duration, inherit the clef, no
  pickup, the single barline, no jump) are music_types', and the rules the
  fields follow are music_editing's `inspector.ts` — the native property sheet
  writes the same pickers, and this file used to re-export copies of them, with
  a `NO_DYNAMIC` of its own that disagreed with the `NO_MARK` the library's
  `DYNAMIC_OPTIONS` uses. Import those from `@sudobility/music_lib` directly.
*/

export const FIELD_LABEL_CLASS = 'text-xs text-theme-text-secondary';

/**
 * One stated height for every field in the panel.
 *
 * An `Input`, a Radix select trigger and a `SheetSelector` each size
 * themselves from their own content and padding, so a column of them comes out
 * ragged no matter how the padding is tuned — the name box, the instrument
 * picker and the clef select were three different heights. Stating it once is
 * the same rule the toolbars follow with `CONTROL_HEIGHT_CLASS`.
 */
export const FIELD_HEIGHT_CLASS = 'h-9';

export const TEXT_INPUT_CLASS = `${FIELD_HEIGHT_CLASS} w-full px-2 py-1.5 text-sm`;

export const SELECT_CLASS = `${FIELD_HEIGHT_CLASS} w-full justify-between px-2 py-1.5 text-sm`;

/** `values[0]` if every entry deep-equals it (by `JSON.stringify`, sufficient for this panel's primitive/plain-object fields), `MIXED` if they differ, or `null` for an empty list. */
export function commonValue<T>(values: T[]): MixedOr<T> | null {
  /*
    The agreement test is music_types' `commonValue`, which both apps' panels
    need and which answers `null` for "they differ". This wrapper keeps *this*
    app's `MIXED` sentinel, because the web inspector distinguishes "no
    selection" (null) from "a selection that disagrees" (MIXED) and the native
    one does not — a difference in what the panel renders, not in the rule.
  */
  if (values.length === 0) return null;
  const agreed = sharedValue(values);
  return agreed === null ? MIXED : agreed;
}
