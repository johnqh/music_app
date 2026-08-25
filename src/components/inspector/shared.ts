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

import { ACCIDENTALS, ARTICULATIONS } from '@sudobility/music_types';
import type { Accidental, Articulation } from '@sudobility/music_types';

export { CLEFS, PITCH_STEPS } from '@sudobility/music_types';

/** Sentinel distinguishing "every selected object agrees" from "differing values" (spec §20's "mixed"). */
export const MIXED = Symbol('mixed');

export type MixedOr<T> = T | typeof MIXED;

/**
 * The label each accidental is written with. A record keyed by the type, not a
 * list beside it: a sixth accidental would fail to compile here rather than
 * quietly go missing from the picker.
 */
const ACCIDENTAL_LABEL: Record<Accidental, string> = {
  [-2]: 'bb',
  [-1]: 'b',
  [0]: 'natural',
  [1]: '#',
  [2]: 'x',
};

/**
 * The picker's entries. Named for what it is — a list of options — rather than
 * `ACCIDENTALS`, which is the vocabulary itself and lives in music_types; two
 * things under one name in two packages is how a picker comes to offer a set
 * the model no longer has.
 */
export const ACCIDENTAL_OPTIONS: Array<{ value: Accidental; label: string }> = ACCIDENTALS.map(
  (value) => ({ value, label: ACCIDENTAL_LABEL[value] }),
);

/** The picker's entries; `ARTICULATIONS` itself is the vocabulary, in music_types. */
export const ARTICULATION_OPTIONS: Array<{ value: Articulation | 'none'; labelKey: string }> = [
  { value: 'none', labelKey: 'articulation.none' },
  ...ARTICULATIONS.map((value) => ({ value, labelKey: `articulation.${value}` })),
];

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
  if (values.length === 0) return null;
  const first = values[0];
  const firstKey = JSON.stringify(first);
  return values.every((v) => JSON.stringify(v) === firstKey) ? first : MIXED;
}
