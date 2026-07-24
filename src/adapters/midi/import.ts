/**
 * Standard MIDI File -> `Score` import (spec §15). `@tonejs/midi` is the
 * designated MIDI library (spec §15) and its use here is a sanctioned
 * exception to the adapters/services "no non-domain library" purity rule.
 *
 * MIDI stores performance timing, not notation semantics — this import is
 * necessarily an approximation (quantization, voice allocation, clef/staff
 * assignment, and key estimation are all best-effort heuristics), which is
 * why every result carries a `warnings` array the caller/wizard is expected
 * to surface (spec §15: "Do not claim MIDI import perfectly reconstructs
 * notation").
 */
import { Midi } from '@tonejs/midi';
import type { Track as SourceMidiTrack } from '@tonejs/midi';
import { detectKeySignature } from '@/adapters/midi/key-detection';
import { assembleTrackMeasures, buildMeasureSpans } from '@/adapters/midi/measures';
import type { TimeSignatureChange } from '@/adapters/midi/measures';
import type { MidiImportOptions } from '@/adapters/midi/import-options';
import { midiToPitch, pitchToMidi } from '@/domain/pitch/pitch';
import { createId } from '@/domain/score/ids';
import type { KeySignature, NoteEvent, Score, TempoEvent, Track } from '@/domain/score/types';
import { isNoteEvent } from '@/domain/score/types';
import type { QuantizeOptions } from '@/domain/quantization/options';
import { quantizeEvents } from '@/domain/quantization/quantize';
import { ticksFor } from '@/domain/time/ticks';
import { allocateVoices } from '@/domain/voicing/allocate';

/** The score model's fixed internal PPQ (spec §4/§15: every import is normalized to 480). */
const SCORE_PPQ = 480;
const DEFAULT_TEMPO_BPM = 120;
const MIN_BPM = 20;
const MAX_BPM = 400;
const MAX_VELOCITY = 127;
const SUSTAIN_CC_NUMBER = 64;
const SUSTAIN_DOWN_THRESHOLD = 0.5;
/** Max simultaneous notated voices `allocateVoices` may open per staff. */
const DEFAULT_MAX_VOICES = 4;
const DEFAULT_KEY_SIGNATURE: KeySignature = { fifths: 0, mode: 'major' };
const PERCUSSION_CHANNEL = 9;

const ALWAYS_WARNING =
  'MIDI import approximates performance timing as notation: quantization, voice/staff assignment, and key detection are best-effort. Review the result before use.';

// ---- Tempo / time signature -----------------------------------------------

function buildTempoMap(sourceTempos: Array<{ ticks: number; bpm: number }>, ratio: number, warnings: string[]): TempoEvent[] {
  const converted = sourceTempos
    .map((t) => ({ tick: Math.round(t.ticks * ratio), bpm: t.bpm }))
    .sort((a, b) => a.tick - b.tick);
  const withOrigin = converted.length > 0 && converted[0].tick === 0 ? converted : [{ tick: 0, bpm: DEFAULT_TEMPO_BPM }, ...converted];

  return withOrigin.map((t) => {
    const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, t.bpm));
    if (bpm !== t.bpm) {
      warnings.push(
        `Tempo event at tick ${t.tick} (${t.bpm.toFixed(1)} bpm) was outside the supported ${MIN_BPM}-${MAX_BPM} bpm range and was clamped to ${bpm} bpm.`,
      );
    }
    return { id: createId(), tick: t.tick, bpm };
  });
}

function convertTimeSignatures(
  sourceTimeSignatures: Array<{ ticks: number; timeSignature: number[] }>,
  ratio: number,
): TimeSignatureChange[] {
  return sourceTimeSignatures.map((t) => ({
    tick: Math.round(t.ticks * ratio),
    timeSignature: { numerator: t.timeSignature[0], denominator: t.timeSignature[1] },
  }));
}

// ---- Sustain pedal ----------------------------------------------------------

type Interval = { start: number; end: number };

/** Pedal-down `[start, end)` intervals (target ticks) from a track's CC64 events; an unreleased pedal closes at `trackEndTick`. */
function sustainIntervals(sourceTrack: SourceMidiTrack, ratio: number, trackEndTick: number): Interval[] {
  const events = [...(sourceTrack.controlChanges[SUSTAIN_CC_NUMBER] ?? [])].sort((a, b) => a.ticks - b.ticks);
  const intervals: Interval[] = [];
  let downStart: number | null = null;

  for (const event of events) {
    const tick = Math.round(event.ticks * ratio);
    const down = event.value >= SUSTAIN_DOWN_THRESHOLD;
    if (down && downStart === null) {
      downStart = tick;
    } else if (!down && downStart !== null) {
      intervals.push({ start: downStart, end: tick });
      downStart = null;
    }
  }
  if (downStart !== null) intervals.push({ start: downStart, end: trackEndTick });

  return intervals;
}

/** Extends `rawEnd` to the release tick of whichever pedal-down interval it falls inside, if any. */
function extendThroughSustain(rawEnd: number, intervals: Interval[]): number {
  for (const interval of intervals) {
    if (rawEnd >= interval.start && rawEnd < interval.end) return interval.end;
  }
  return rawEnd;
}

// ---- Raw note extraction -----------------------------------------------------

type RawNote = { midi: number; startTick: number; durationTicks: number; velocity: number };

/**
 * Converts a source track's notes to target-tick `RawNote`s, optionally
 * extending each note's end through a sustain-pedal-down interval it falls
 * in (`sustainPedal: "extend"`). A same-pitch note's sustain extension is
 * then clamped so it never overlaps the *next* onset of that same pitch
 * (extending into a genuinely different pitch is fine and expected — that's
 * exactly what a pedal is for).
 */
function extractRawNotes(sourceTrack: SourceMidiTrack, ratio: number, sustainPedal: MidiImportOptions['sustainPedal']): RawNote[] {
  const trackEndTick = Math.round(sourceTrack.durationTicks * ratio);
  const intervals = sustainPedal === 'extend' ? sustainIntervals(sourceTrack, ratio, trackEndTick) : [];

  const spans = sourceTrack.notes.map((note) => {
    const startTick = Math.round(note.ticks * ratio);
    const rawEnd = Math.round((note.ticks + note.durationTicks) * ratio);
    const endTick = intervals.length > 0 ? extendThroughSustain(rawEnd, intervals) : rawEnd;
    return { midi: note.midi, startTick, endTick, velocity: note.velocity };
  });

  const byPitch = new Map<number, typeof spans>();
  for (const span of spans) {
    const bucket = byPitch.get(span.midi);
    if (bucket) bucket.push(span);
    else byPitch.set(span.midi, [span]);
  }
  for (const bucket of byPitch.values()) {
    bucket.sort((a, b) => a.startTick - b.startTick);
    for (let i = 0; i < bucket.length - 1; i += 1) {
      if (bucket[i].endTick > bucket[i + 1].startTick) {
        bucket[i].endTick = bucket[i + 1].startTick;
      }
    }
  }

  return spans.map((span) => ({
    midi: span.midi,
    startTick: span.startTick,
    durationTicks: Math.max(1, span.endTick - span.startTick),
    velocity: Math.min(MAX_VELOCITY, Math.max(0, Math.round(span.velocity * MAX_VELOCITY))),
  }));
}

// ---- Quantization -------------------------------------------------------------

function quantizeOptionsFor(options: MidiImportOptions): QuantizeOptions {
  const quantizing = options.quantizeGrid !== null;
  const grid = quantizing ? ticksFor(options.quantizeGrid as NonNullable<MidiImportOptions['quantizeGrid']>, SCORE_PPQ) : 1;
  return {
    grid,
    quantizeStarts: quantizing,
    quantizeDurations: quantizing,
    tripletGrid: quantizing && options.tripletDetection,
    minDurationTicks: options.minDurationTicks,
    chordToleranceTicks: options.mergeNearDuplicates ? Math.max(1, Math.round(grid / 4)) : undefined,
    resolveOverlaps: true,
  };
}

// ---- Prepared per-selection data ----------------------------------------------

type PreparedSelection = {
  selection: MidiImportOptions['trackSelections'][number];
  sourceTrack: SourceMidiTrack;
  notes: NoteEvent[];
};

/** Quantizes a selection's raw notes (dropping/merging/snapping per `options`), tagged with a temporary per-selection trackId so `quantizeEvents` groups them correctly. */
function prepareSelectionNotes(
  raw: RawNote[],
  tempTrackId: string,
  options: MidiImportOptions,
): NoteEvent[] {
  const events: NoteEvent[] = raw.map((n) => ({
    id: createId(),
    pitch: midiToPitch(n.midi),
    startTick: n.startTick,
    durationTicks: n.durationTicks,
    velocity: n.velocity,
    voiceId: 'import',
    trackId: tempTrackId,
  }));

  const quantized = quantizeEvents(events, quantizeOptionsFor(options));
  return quantized.filter(isNoteEvent);
}

// ---- Track assembly -------------------------------------------------------------

function trackVolume(sourceTrack: SourceMidiTrack): number {
  const cc = sourceTrack.controlChanges[7]?.[0];
  return cc ? cc.value : 1;
}

function trackPan(sourceTrack: SourceMidiTrack): number {
  const cc = sourceTrack.controlChanges[10]?.[0];
  return cc ? cc.value * 2 - 1 : 0;
}

function buildSingleTrack(
  prepared: PreparedSelection,
  spans: ReturnType<typeof buildMeasureSpans>,
  keySignature: KeySignature,
): Track {
  const trackId = createId();
  const groups = allocateVoices(prepared.notes, { maxVoices: DEFAULT_MAX_VOICES, splitPoint: Number.NEGATIVE_INFINITY });
  const lanes = groups.map((g) => g.notes);
  const measures = assembleTrackMeasures(lanes, spans, keySignature, trackId);
  const clef = prepared.selection.clef;

  return {
    id: trackId,
    name: prepared.selection.name,
    instrumentName: prepared.sourceTrack.instrument.name || 'Instrument',
    midiProgram: prepared.sourceTrack.instrument.number,
    midiChannel: clef === 'percussion' ? PERCUSSION_CHANNEL : Math.min(15, Math.max(0, prepared.sourceTrack.channel)),
    clef,
    volume: trackVolume(prepared.sourceTrack),
    pan: trackPan(prepared.sourceTrack),
    muted: false,
    solo: false,
    measures,
  };
}

/** Splits `prepared` into two linked grand-staff tracks ("Piano RH" upper/treble, "Piano LH" lower/bass) at `options.splitPointMidi`. */
function buildSplitTracks(
  prepared: PreparedSelection,
  spans: ReturnType<typeof buildMeasureSpans>,
  keySignature: KeySignature,
  splitPointMidi: number,
): Track[] {
  const groups = allocateVoices(prepared.notes, { maxVoices: DEFAULT_MAX_VOICES, splitPoint: splitPointMidi });
  const upperLanes = groups.filter((g) => g.staff === 'upper').map((g) => g.notes);
  const lowerLanes = groups.filter((g) => g.staff === 'lower').map((g) => g.notes);

  const rhId = createId();
  const lhId = createId();
  const shared = {
    instrumentName: prepared.sourceTrack.instrument.name || 'Instrument',
    midiProgram: prepared.sourceTrack.instrument.number,
    midiChannel: Math.min(15, Math.max(0, prepared.sourceTrack.channel)),
    volume: trackVolume(prepared.sourceTrack),
    pan: trackPan(prepared.sourceTrack),
    muted: false,
    solo: false,
  };

  return [
    {
      id: rhId,
      name: 'Piano RH',
      clef: 'treble',
      ...shared,
      measures: assembleTrackMeasures(upperLanes, spans, keySignature, rhId),
    },
    {
      id: lhId,
      name: 'Piano LH',
      clef: 'bass',
      ...shared,
      measures: assembleTrackMeasures(lowerLanes, spans, keySignature, lhId),
    },
  ];
}

// ---- Entry point ------------------------------------------------------------

export type MidiImportResult = { score: Score; warnings: string[] };

/**
 * Imports a Standard MIDI File as a `Score` (spec §15): converts note times
 * to 480-ppq score ticks, imports the tempo map and time signatures,
 * applies sustain-pedal extension, Task 4 quantization (grid/triplet/
 * minimum-duration/near-duplicate merging), key estimation and enharmonic
 * respelling, Task 4 voice allocation, optional piano grand-staff split,
 * and measure generation (notes split across measure boundaries with
 * ties) — per track selected in `options.trackSelections`. Always returns a
 * `warnings` array (never throws for merely-imperfect input); the caller is
 * expected to surface it before the import is committed (spec §15: MIDI
 * import must be reviewable, and one undoable operation once committed).
 */
export function importMidi(data: ArrayBuffer, options: MidiImportOptions): MidiImportResult {
  const warnings: string[] = [ALWAYS_WARNING];
  const midi = new Midi(data);
  const ratio = SCORE_PPQ / midi.header.ppq;

  const tempoMap = buildTempoMap(midi.header.tempos, ratio, warnings);
  const timeSignatureChanges = convertTimeSignatures(midi.header.timeSignatures, ratio);

  const preparedSelections: PreparedSelection[] = [];
  for (const selection of options.trackSelections) {
    if (!selection.include) continue;
    const sourceTrack = midi.tracks[selection.sourceIndex];
    if (!sourceTrack) {
      warnings.push(`Track selection references source track ${selection.sourceIndex}, which doesn't exist in this file; it was skipped.`);
      continue;
    }

    const raw = extractRawNotes(sourceTrack, ratio, options.sustainPedal);
    const notes = prepareSelectionNotes(raw, `import-${selection.sourceIndex}`, options);
    const dropped = raw.length - notes.length;
    if (dropped > 0) {
      warnings.push(`Track "${selection.name}": dropped ${dropped} note(s) shorter than ${options.minDurationTicks} ticks.`);
    }

    preparedSelections.push({ selection, sourceTrack, notes });
  }

  if (preparedSelections.length === 0) {
    warnings.push('No tracks were selected for import; the imported score has no tracks.');
  }

  const allNotes = preparedSelections.flatMap((p) => p.notes);
  const keySignature = options.detectKey ? detectKeySignature(allNotes) : DEFAULT_KEY_SIGNATURE;
  const respelledSelections = preparedSelections.map((p) => ({
    ...p,
    notes: p.notes.map((n) => ({ ...n, pitch: midiToPitch(pitchToMidi(n.pitch), keySignature) })),
  }));

  const endTick = respelledSelections.reduce((max, p) => {
    const localMax = p.notes.reduce((m, n) => Math.max(m, n.startTick + n.durationTicks), 0);
    return Math.max(max, localMax);
  }, 0);
  const spans = buildMeasureSpans(timeSignatureChanges, SCORE_PPQ, endTick);

  const tracks: Track[] = respelledSelections.flatMap((prepared) =>
    options.pianoStaffSplit
      ? buildSplitTracks(prepared, spans, keySignature, options.splitPointMidi)
      : [buildSingleTrack(prepared, spans, keySignature)],
  );

  const now = new Date().toISOString();
  const score: Score = {
    id: createId(),
    version: 1,
    ppq: SCORE_PPQ,
    metadata: {
      title: midi.header.name.trim().length > 0 ? midi.header.name.trim() : 'Imported MIDI',
      createdAt: now,
      updatedAt: now,
    },
    tempoMap,
    tracks,
  };

  return { score, warnings };
}
