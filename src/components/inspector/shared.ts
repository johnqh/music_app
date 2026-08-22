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

import type { Accidental, Articulation, Clef, PitchStep } from '@sudobility/music_types';

/** Sentinel distinguishing "every selected object agrees" from "differing values" (spec §20's "mixed"). */
export const MIXED = Symbol('mixed');

export type MixedOr<T> = T | typeof MIXED;

export const PITCH_STEPS: PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export const ACCIDENTALS: Array<{ value: Accidental; label: string }> = [
  { value: -2, label: 'bb' },
  { value: -1, label: 'b' },
  { value: 0, label: 'natural' },
  { value: 1, label: '#' },
  { value: 2, label: 'x' },
];

export const ARTICULATIONS: Array<{ value: Articulation | 'none'; labelKey: string }> = [
  { value: 'none', labelKey: 'articulation.none' },
  { value: 'staccato', labelKey: 'articulation.staccato' },
  { value: 'accent', labelKey: 'articulation.accent' },
  { value: 'tenuto', labelKey: 'articulation.tenuto' },
  { value: 'marcato', labelKey: 'articulation.marcato' },
];

export const CLEFS: Clef[] = ['treble', 'bass', 'alto', 'tenor', 'percussion'];

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
