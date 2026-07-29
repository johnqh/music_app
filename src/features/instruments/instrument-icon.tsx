/**
 * Emoji icons for General MIDI instruments.
 *
 * Emoji rather than an SVG set, deliberately: this app's chrome is already
 * emoji throughout (`◀◀ ▶ ■ 💾 ↶ ↷ 🌓 ⚙ ✕ ▴ ▾`), so a bespoke instrument SVG
 * set would be the inconsistent choice, and ~36 hand-drawn glyphs is an
 * illustration project with ongoing upkeep for a label-sized affordance. The
 * trade, recorded so it is not mistaken for an oversight: emoji render
 * differently across platforms and cannot be recoloured to the theme.
 */
import { gmFamilyOf, gmInstrument } from '@sudobility/music_lib';
import type { GmFamily } from '@sudobility/music_lib';

/** Hand-picked glyphs for the instruments people actually reach for. */
const PROGRAM_EMOJI: Record<number, string> = {
  0: '🎹', // Acoustic Grand Piano
  1: '🎹', // Bright Acoustic Piano
  4: '🎹', // Electric Piano 1
  6: '🎹', // Harpsichord
  11: '🎵', // Vibraphone
  16: '🪗', // Drawbar Organ
  19: '🎛️', // Church Organ
  21: '🪗', // Accordion
  22: '🎶', // Harmonica
  24: '🎸', // Acoustic Guitar (nylon)
  25: '🎸', // Acoustic Guitar (steel)
  27: '🎸', // Electric Guitar (clean)
  30: '🎸', // Distortion Guitar
  32: '🎸', // Acoustic Bass
  33: '🎸', // Electric Bass (finger)
  40: '🎻', // Violin
  42: '🎻', // Cello
  46: '🎼', // Orchestral Harp
  48: '🎻', // String Ensemble 1
  52: '🎤', // Choir Aahs
  56: '🎺', // Trumpet
  57: '🎺', // Trombone
  58: '🎺', // Tuba
  64: '🎷', // Soprano Sax
  65: '🎷', // Alto Sax
  66: '🎷', // Tenor Sax
  71: '🎶', // Clarinet
  72: '🪈', // Piccolo
  73: '🪈', // Flute
  74: '🪈', // Recorder
  104: '🪕', // Sitar
  105: '🪕', // Banjo
  114: '🥁', // Steel Drums
  116: '🥁', // Taiko Drum
};

/** Every family has one, so all 128 programs resolve to something. */
const FAMILY_EMOJI: Record<GmFamily, string> = {
  piano: '🎹',
  'chromatic-percussion': '🎵',
  organ: '🪗',
  guitar: '🎸',
  bass: '🎸',
  strings: '🎻',
  ensemble: '🎼',
  brass: '🎺',
  reed: '🎷',
  pipe: '🪈',
  'synth-lead': '🎛️',
  'synth-pad': '🎛️',
  'synth-effects': '✨',
  ethnic: '🪕',
  percussive: '🥁',
  'sound-effects': '🔊',
};

/** The hand-picked glyph for `program`, else its family's. */
export function instrumentEmoji(program: number): string {
  const picked = PROGRAM_EMOJI[program];
  if (picked) return picked;
  // An out-of-range program has no family; fall back rather than render blank.
  return gmInstrument(program) ? FAMILY_EMOJI[gmFamilyOf(program)] : FAMILY_EMOJI.piano;
}

export type InstrumentIconProps = { program: number; className?: string };

/**
 * Decorative: the instrument's name is always rendered beside it, so this is
 * `aria-hidden` and screen readers get the name rather than an emoji reading.
 */
export function InstrumentIcon({ program, className }: InstrumentIconProps) {
  return (
    <span aria-hidden="true" className={className}>
      {instrumentEmoji(program)}
    </span>
  );
}
