/**
 * The instruments an AI request can ask for, and how to render them as a menu.
 *
 * One catalog, shared by the two generation dialogs, so "what can I ask for"
 * has a single answer: all 128 General MIDI programs grouped by their standard
 * family, plus the eight GM drum kits.
 *
 * Kits come first and are tagged rather than numbered, because a kit's program
 * means something else entirely from a melodic one: on channel 10, program 8
 * is the Room Kit, not Celesta. `TrackEditorPanel` records the bug that
 * conflating them caused.
 */
import {
  GM_FAMILIES,
  GM_FAMILY_LABELS,
  GM_KITS,
  gmInstrument,
  gmInstrumentsByFamily,
  gmKit,
} from '@sudobility/music_lib';
import type { Clef } from '@sudobility/music_types';

/** What a caller needs to build a `GenerateScoreRequestTrack`. */
export type InstrumentChoice = {
  midiProgram: number;
  instrumentName: string;
  clef: Clef;
};

const KIT_PREFIX = 'kit:';

/** The default selection: Piano, which is also the melody-carrying lead. */
export const DEFAULT_INSTRUMENT_VALUE = '0';

export const KIT_OPTIONS = GM_KITS.map((kit) => ({
  value: `${KIT_PREFIX}${kit.program}`,
  label: kit.name,
}));

export const FAMILY_GROUPS = GM_FAMILIES.map((family) => ({
  key: family,
  label: GM_FAMILY_LABELS[family],
  instruments: gmInstrumentsByFamily(family),
}));

/**
 * The clef a melodic program is written on.
 *
 * Only the Bass family reads better on the bass staff; everything else starts
 * on treble, which can be changed on the track afterwards.
 */
function clefForProgram(program: number): Clef {
  return program >= 32 && program <= 39 ? 'bass' : 'treble';
}

export function instrumentChoiceFor(value: string): InstrumentChoice {
  if (value.startsWith(KIT_PREFIX)) {
    // `gmKit` rather than the raw number: an address no kit sits on falls back
    // to Standard instead of producing a track nothing can play.
    const kit = gmKit(Number(value.slice(KIT_PREFIX.length))) ?? GM_KITS[0];
    return { midiProgram: kit.program, instrumentName: kit.name, clef: 'percussion' };
  }
  const program = Number(value);
  return {
    midiProgram: program,
    instrumentName: gmInstrument(program)?.name ?? 'Piano',
    clef: clefForProgram(program),
  };
}

/** The label shown for a catalog value. */
export function instrumentLabelFor(value: string): string {
  return instrumentChoiceFor(value).instrumentName;
}
