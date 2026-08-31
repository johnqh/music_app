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

export { CLEFS, PITCH_STEPS } from '@sudobility/music_types';

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

/*
  The picker's entries are music_types', not this app's.

  This list existed here, in music_app_rn's toolbar and in its Note tab, and the
  three agreed only because nobody had added a fifth articulation yet. It is
  mapped off the vocabulary beside the vocabulary now, so a new member reaches
  every picker in both apps without anybody remembering to.
*/
export { ARTICULATION_OPTIONS, ORNAMENT_OPTIONS, NO_MARK } from '@sudobility/music_types';

export const MIXED_VALUE = '__mixed__';

/**
 * Stands for a length no single note value spells — a tie join or an import can
 * leave one. Shown so the picker states what the note actually is instead of
 * relabelling it as the nearest name, and inert when chosen.
 */
export const CUSTOM_DURATION = '__custom__';

/** "No marking here", distinct from a marking that happens to be quiet. */
export const NO_DYNAMIC = '__none__';

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

/** Radix rejects an empty item value, so "inherit" travels under a sentinel. */
export const INHERIT_CLEF = 'inherit';

/** Same Radix constraint as the clef sentinel: "no pickup" needs a value. */
export const NO_PICKUP = 'none';

/** The ordinary barline is the absence of a style, and Radix needs a value. */
export const SINGLE_BARLINE = 'single';

/** Radix again: "no jump" needs a value of its own. */
export const NO_JUMP = 'none';

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
