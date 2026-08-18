# Tracker Export Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship working `Export → XM Module`, and with it the whole export pipeline the other three formats will reuse.

**Architecture:** Mirrors import exactly, and reuses its model. `scoreToTracker(score, options)` in `music_lib` does the musical work — quantise to a row grid, allocate voices to channels, clamp pitches, derive speed/tempo — and returns `{ module, report }` with no bytes involved. `TrackerCodec.encode(module)` in `music_io` turns the neutral `TrackerModule` into that format's bytes. The app puts the scope dialog first, computes the fit, and only interrupts the user when something was actually lost.

**Tech Stack:** TypeScript (strict), vitest. No new dependencies.

## Global Constraints

- **No sample data is ever written.** A module is a notes format under the notes/audio split, so nothing is rendered into it. Zero-sample instrument slots are structurally valid — `sunlight.xm` has eight of them among fifteen, which is what proves our own reader accepts the shape we are about to write.
- Instrument slots are **named** after the track's instrument. Every format has a name field, so this is free, and it is what lets a tracker user drop their own samples into the right slots.
- **The exported file is silent until someone adds samples, and the UI must say so.** Unstated, it reads as a broken export.
- `scoreToTracker` is **pure** — score in, module and report out. No bytes, no platform, no store. Same split `trackerToScore` has.
- Export writes only `mod`, `s3m`, `xm`, `it`. **DSM and MPTM stay import-only**: nothing reads DSM that does not read a better format, and OpenMPT reads IT natively.
- Formats after XM are separate plans. This one ends with XM working end to end.

---

## Verified facts

Measured against the current code before this plan was written. Each one is a
place a wrong assumption would cost a rewrite.

### The row grid already has a fixed meaning

`import.ts` uses `ROWS_PER_BEAT = 4` and `BEATS_PER_MEASURE = 4`, so a row is a
sixteenth and a 4/4 bar is 16 rows. Exporting at `rowsPerBeat = 4` into 64-row
patterns therefore gives **exactly four 4/4 bars per pattern**, and the importer
reads back the same grid it was written on. This is what makes the round-trip
test in Task 3 meaningful rather than approximate.

### Speed and tempo invert cleanly, and `speed = 6` is the identity

`effectiveBpm(speed, tempo) = round(6 × tempo / speed)` (`timing.ts`). So at
**speed 6, `tempo` is the BPM exactly** — `effectiveBpm(6, 125) === 125`.

The catch is that `tempo` is one byte and trackers expect it in 32–255, while a
score's BPM may be 20–400 (the validator's range, pinned in `timing.ts` as
`MIN_BPM`/`MAX_BPM`). One speed does not cover it, so pick from three:

| Score BPM | speed | tempo = round(bpm × speed / 6) |
| --------- | ----- | ------------------------------ |
| < 32      | 12    | 40 at bpm 20                   |
| 32–255    | 6     | equal to the BPM               |
| > 255     | 3     | 200 at bpm 400                 |

Every score-legal BPM lands in 32–255 under this rule. Task 2 pins all three.

### MOD's note range is anchored to our own decoder, not to folklore

`period.ts` defines ProTracker's C-1 period 856 as **MIDI 36**, with a test
pinning it. Three octaves is therefore **MIDI 36–71**, and the export must use
that number — a different but equally defensible choice would make a MOD
round-trip fail for reasons that look like a writer bug.

The other three follow their decoders the same way:

| Target | Channels | Instruments | MIDI range | Anchor                                 |
| ------ | -------- | ----------- | ---------- | -------------------------------------- |
| MOD    | 4        | 31          | 36–71      | `period.ts` reference period           |
| S3M    | 32       | 99          | 12–107     | `s3m.ts` `NOTE_BASE = 12`, octaves 0–7 |
| XM     | 32       | 128         | 12–107     | `xm.ts` `NOTE_BASE = 11`, notes 1–96   |
| IT     | 64       | 99          | 0–119      | `it.ts` `NOTE_BASE = 0`, notes 0–119   |

Only XM is written by this plan; the table lands whole because `scoreToTracker`
takes the format and reports against its limits, and Task 2 tests all four rows
without needing any writer but XM.

### Tempo survives a round trip only in cells, and XM's split point lines up exactly

`TrackerModule` has **no** initial-speed/tempo field — only per-cell
`speed`/`bpm` — and `tempoChanges` starts from `DEFAULT_SPEED = 6` /
`DEFAULT_TEMPO = 125` and moves only where a cell says so. So the XM _header's_
tempo fields are for real trackers; our own importer never reads them. The
writer must emit row 0's knobs as cell effects **as well as** into the header,
or a round trip silently returns 125 BPM.

XM's `F` carries both knobs, split at `0x20`: below is speed, at or above is
BPM. That split lands exactly where `speedAndTempoFor` already puts its output —
speed is always one of {3, 6, 12}, all below 0x20, and tempo is always 32–255,
all at or above it, because `MIN_TEMPO = 32 = 0x20`. The two constraints agree
by construction, so no clamping is needed at the byte layer.

What does _not_ fit is both knobs in one cell: XM has one effect column, so a
row changing speed and BPM together needs two channels. Task 3 spreads them.

### The XM byte layout is already proven

`xm-fixture.ts`'s `buildXm` writes XM that `readXm` reads, and its tests pass.
The writer in Task 3 is that layout generalised — **not** a fresh reading of the
format — which is why Task 3 is small. Specifically: a 60+276 byte header,
9-byte pattern headers with mask-form packing, and **33-byte instrument headers**
for the zero-sample slots we write. `sunlight.xm` proves real files use that
form and our reader handles it.

### The app surface exists and is not being redesigned

`withExportScope(write)` in `AppLayout.tsx:401` already runs the scope dialog
and hands back a scoped `Score`; `handleExportMidi` (line 450) is the shape to
copy. `ConfirmDialog` and `ExportScopeDialog` both exist. Scope runs **first**,
because exporting visible tracks only may bring a score within a channel limit
that all tracks exceed — computing the fit before scope would describe the wrong
score.

---

## File Structure

- **Create** `music_lib/src/adapters/mod/limits.ts` — the per-format limits table.
- **Create** `music_lib/src/adapters/mod/export.ts` — `scoreToTracker`, the fit report.
- **Create** `music_lib/src/adapters/mod/export.test.ts`.
- **Modify** `music_lib/src/index.ts` — re-export both, beside the existing `adapters/mod` lines (89–92).
- **Modify** `music_types/src/platform/mod.ts` — add `encode` to `TrackerCodec`.
- **Create** `music_io/src/shared/tracker/xm-write.ts` — `encodeXm`.
- **Create** `music_io/src/shared/tracker/xm-write.test.ts` — byte structure and round trip.
- **Modify** `music_io/src/shared/mod/codec.ts` — implement `encode`.
- **Modify** `music_app/src/components/layout/AppLayout.tsx` — `handleExportModule`, menu entry, fit dialog.
- **Create** `music_app/src/components/dialogs/TrackerFitDialog.tsx`.
- **Modify** `music_app/CLAUDE.md`, `music_app/docs/spec.md` — the "Import only" rule and the export list.

---

### Task 1: Limits, the fit report, and the codec seam

**Files:**

- Create: `music_lib/src/adapters/mod/limits.ts`
- Modify: `music_types/src/platform/mod.ts`

**Interfaces:**

- Produces: `TRACKER_LIMITS`, `TrackerLimits`, `WritableTrackerFormat` from `limits.ts`; `TrackerCodec.encode(module: TrackerModule): ArrayBuffer` in music_types. Tasks 2–4 consume all of them.

- [ ] **Step 1: Write the limits table**

Create `music_lib/src/adapters/mod/limits.ts`:

```ts
/**
 * What each tracker format can hold.
 *
 * Every number here is anchored to **our own decoder** rather than to the
 * format documentation, because the two only have to agree with each other for
 * a round trip to work. MOD's range is the clearest case: `period.ts` takes
 * ProTracker's C-1 period as MIDI 36, so three octaves is 36-71. A different
 * but equally defensible anchor would fail the round-trip test for reasons that
 * look like a writer bug.
 *
 * DSM and MPTM are absent deliberately: nothing reads DSM that does not read a
 * better format, and OpenMPT reads IT natively, so writing either buys nothing.
 */
import type { TrackerFormat } from '@sudobility/music_types';

/** The formats export can write. A subset of `TrackerFormat`, which import also covers. */
export type WritableTrackerFormat = 'mod' | 's3m' | 'xm' | 'it';

export type TrackerLimits = {
  channels: number;
  instruments: number;
  /** Inclusive MIDI note range this format can express. */
  lowestMidi: number;
  highestMidi: number;
};

export const TRACKER_LIMITS: Record<WritableTrackerFormat, TrackerLimits> = {
  // Three octaves, anchored on period.ts's C-1 = MIDI 36.
  mod: { channels: 4, instruments: 31, lowestMidi: 36, highestMidi: 71 },
  // s3m.ts: NOTE_BASE 12, octaves 0-7 -> 12 + 7*12 + 11 = 107.
  s3m: { channels: 32, instruments: 99, lowestMidi: 12, highestMidi: 107 },
  // xm.ts: NOTE_BASE 11, notes 1-96 -> 12..107.
  xm: { channels: 32, instruments: 128, lowestMidi: 12, highestMidi: 107 },
  // it.ts: NOTE_BASE 0, notes 0-119.
  it: { channels: 64, instruments: 99, lowestMidi: 0, highestMidi: 119 },
};

export function isWritableTrackerFormat(format: TrackerFormat): format is WritableTrackerFormat {
  return format === 'mod' || format === 's3m' || format === 'xm' || format === 'it';
}
```

- [ ] **Step 2: Add `encode` to the codec interface**

In `music_types/src/platform/mod.ts`, extend the `TrackerCodec` interface:

```ts
export interface TrackerCodec {
  /** Sniffs the format from the bytes and decodes it. Throws on anything that is not one, rather than returning a garbage module that looks imported. */
  decode(bytes: ArrayBuffer): TrackerModule;
  /**
   * Writes a module out, in the format `module.format` names.
   *
   * No sample data is written: a module is a notes format, so the slots are
   * named and empty and the file is silent until somebody fills them. Throws
   * for a format export does not write (`dsm`, `mptm`) rather than guessing a
   * near neighbour.
   */
  encode(module: TrackerModule): ArrayBuffer;
}
```

- [ ] **Step 3: Typecheck both packages**

Run: `cd music_types && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS.

Run: `cd music_io && bunx tsc --noEmit -p tsconfig.json`
Expected: **FAIL** — `SharedTrackerCodec` does not implement `encode`. That is the seam being real; Task 3 closes it.

- [ ] **Step 4: Commit**

```bash
cd music_types && git add -A && git commit -m "feat: add encode to the TrackerCodec capability"
cd ../music_lib && git add src/adapters/mod/limits.ts && git commit -m "feat: per-format tracker limits, anchored to our own decoders"
```

---

### Task 2: `scoreToTracker`

**Files:**

- Create: `music_lib/src/adapters/mod/export.ts`
- Create: `music_lib/src/adapters/mod/export.test.ts`
- Modify: `music_lib/src/index.ts`

**Interfaces:**

- Consumes: `TRACKER_LIMITS`, `WritableTrackerFormat` (Task 1).
- Produces: `scoreToTracker(score, options): TrackerExportResult`, and the types `TrackerExportOptions`, `TrackerFitReport`, `TrackerExportResult`. Tasks 3–4 consume them.

This is the whole musical conversion and the only task with real algorithmic
content. Everything lossy happens here and is counted rather than hidden.

- [ ] **Step 1: Write the failing tests**

Create `music_lib/src/adapters/mod/export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../../domain/score/factory.js';
import { createId } from '../../domain/score/ids.js';
import { midiToPitch } from '../../domain/pitch/pitch.js';
import type { NoteEvent, Score } from '@sudobility/music_types';
import { scoreToTracker } from './export.js';

/** A score with one note per entry, placed on the first track's first measure. */
function scoreWithNotes(
  notes: Array<{ midi: number; startTick: number; durationTicks: number; voice?: number }>,
  opts: { tracks?: number; measures?: number } = {},
): Score {
  const base = createEmptyScore({
    title: 'Test',
    measures: opts.measures ?? 1,
    tracks: Array.from({ length: opts.tracks ?? 1 }, (_, i) => ({
      name: `T${i + 1}`,
      instrumentName: 'Acoustic Grand Piano',
      clef: 'treble' as const,
    })),
  });
  const track = base.tracks[0];
  const measure = track.measures[0];
  const byVoice = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const v = n.voice ?? 0;
    if (!byVoice.has(v)) byVoice.set(v, []);
    byVoice.get(v)!.push({
      id: createId(),
      pitch: midiToPitch(n.midi),
      startTick: n.startTick,
      durationTicks: n.durationTicks,
      velocity: 80,
      voiceId: '',
      trackId: track.id,
    });
  }
  const voices = [...byVoice.entries()].map(([i, events]) => {
    const id = measure.voices[i]?.id ?? createId();
    return { id, name: `Voice ${i + 1}`, events: events.map((e) => ({ ...e, voiceId: id })) };
  });
  return {
    ...base,
    tracks: base.tracks.map((t, i) =>
      i === 0 ? { ...t, measures: [{ ...measure, voices }, ...t.measures.slice(1)] } : t,
    ),
  };
}

describe('scoreToTracker', () => {
  it('places a note on the row its tick lands on', () => {
    // ppq 480, rowsPerBeat 4 -> 120 ticks per row. Tick 240 is row 2.
    const score = scoreWithNotes([{ midi: 60, startTick: 240, durationTicks: 120 }]);
    const { module } = scoreToTracker(score, { format: 'xm' });
    expect(module.patterns[0][2][0].note).toBe(60);
    expect(module.patterns[0][2][0].instrument).toBe(1);
  });

  it('writes a release on the row the note ends', () => {
    const score = scoreWithNotes([{ midi: 60, startTick: 0, durationTicks: 240 }]);
    const { module } = scoreToTracker(score, { format: 'xm' });
    expect(module.patterns[0][2][0].note).toBe('off');
  });

  it('reports nothing lost for a score that fits', () => {
    const score = scoreWithNotes([{ midi: 60, startTick: 0, durationTicks: 480 }]);
    const { report } = scoreToTracker(score, { format: 'xm' });
    expect(report).toEqual({
      clampedNotes: 0,
      droppedVoices: 0,
      droppedShortNotes: 0,
      quantisedNotes: 0,
    });
  });

  it('clamps a note below the format range by whole octaves and counts it', () => {
    // MIDI 24 is below MOD's 36. One octave up is 36, which is in range.
    const score = scoreWithNotes([{ midi: 24, startTick: 0, durationTicks: 480 }]);
    const { module, report } = scoreToTracker(score, { format: 'mod' });
    expect(report.clampedNotes).toBe(1);
    expect(module.patterns[0][0][0].note).toBe(36);
  });

  it('clamps a note above the format range by whole octaves', () => {
    // MIDI 96 is above MOD's 71. Two octaves down is 72 — still above — so 60.
    const score = scoreWithNotes([{ midi: 96, startTick: 0, durationTicks: 480 }]);
    const { module, report } = scoreToTracker(score, { format: 'mod' });
    expect(report.clampedNotes).toBe(1);
    expect(module.patterns[0][0][0].note).toBe(60);
  });

  it('does not clamp the same note in a format that can hold it', () => {
    const score = scoreWithNotes([{ midi: 24, startTick: 0, durationTicks: 480 }]);
    const { module, report } = scoreToTracker(score, { format: 'it' });
    expect(report.clampedNotes).toBe(0);
    expect(module.patterns[0][0][0].note).toBe(24);
  });

  it('counts a note that does not land on a row', () => {
    // 60 ticks is half a row at ppq 480.
    const score = scoreWithNotes([{ midi: 60, startTick: 60, durationTicks: 480 }]);
    const { report } = scoreToTracker(score, { format: 'xm' });
    expect(report.quantisedNotes).toBe(1);
  });

  it('drops a note shorter than one row and counts it', () => {
    const score = scoreWithNotes([{ midi: 60, startTick: 0, durationTicks: 30 }]);
    const { report } = scoreToTracker(score, { format: 'xm' });
    expect(report.droppedShortNotes).toBe(1);
    expect(report.quantisedNotes).toBe(0);
  });

  it('gives each voice its own channel', () => {
    const score = scoreWithNotes([
      { midi: 60, startTick: 0, durationTicks: 480, voice: 0 },
      { midi: 64, startTick: 0, durationTicks: 480, voice: 1 },
    ]);
    const { module, report } = scoreToTracker(score, { format: 'xm' });
    expect(module.channels).toBeGreaterThanOrEqual(2);
    expect(module.patterns[0][0][0].note).toBe(60);
    expect(module.patterns[0][0][1].note).toBe(64);
    expect(report.droppedVoices).toBe(0);
  });

  it('drops voices past the format channel limit and counts them', () => {
    // Five voices on one track cannot fit MOD's four channels.
    const score = scoreWithNotes(
      [0, 1, 2, 3, 4].map((v) => ({ midi: 60 + v, startTick: 0, durationTicks: 480, voice: v })),
    );
    const { module, report } = scoreToTracker(score, { format: 'mod' });
    expect(module.channels).toBe(4);
    expect(report.droppedVoices).toBe(1);
  });

  it('names one instrument slot per track', () => {
    const score = scoreWithNotes([{ midi: 60, startTick: 0, durationTicks: 480 }], { tracks: 2 });
    const { module } = scoreToTracker(score, { format: 'xm' });
    expect(module.instruments).toHaveLength(2);
    expect(module.instruments[0]).toEqual({ index: 1, name: 'Acoustic Grand Piano' });
  });

  it('reports the format it was asked for', () => {
    const score = scoreWithNotes([{ midi: 60, startTick: 0, durationTicks: 480 }]);
    expect(scoreToTracker(score, { format: 'xm' }).module.format).toBe('xm');
    expect(scoreToTracker(score, { format: 'mod' }).module.format).toBe('mod');
  });

  it('cuts patterns into 64 rows and orders them in sequence', () => {
    // 8 bars of 4/4 at 16 rows a bar is 128 rows: two full patterns.
    const score = scoreWithNotes([{ midi: 60, startTick: 0, durationTicks: 480 }], { measures: 8 });
    const { module } = scoreToTracker(score, { format: 'xm' });
    expect(module.patterns).toHaveLength(2);
    for (const p of module.patterns) expect(p).toHaveLength(64);
    expect(module.order).toEqual([0, 1]);
  });
});

describe('speed and tempo', () => {
  const speedTempoAt = (bpm: number) => {
    const base = createEmptyScore({
      title: 'T',
      measures: 1,
      tracks: [{ name: 'A', instrumentName: 'Piano', clef: 'treble' as const }],
    });
    const score: Score = { ...base, tempoMap: [{ tick: 0, bpm }] };
    const cell = scoreToTracker(score, { format: 'xm' }).module.patterns[0][0][0];
    return { speed: cell.speed, bpm: cell.bpm };
  };

  it('uses speed 6 in the common range, where tempo is the BPM exactly', () => {
    // effectiveBpm(6, 125) === 125 — this is the identity the importer inverts.
    expect(speedTempoAt(125)).toEqual({ speed: 6, bpm: 125 });
  });

  it('raises speed for a slow score so tempo stays a legal byte', () => {
    expect(speedTempoAt(20)).toEqual({ speed: 12, bpm: 40 });
  });

  it('lowers speed for a fast score so tempo stays a legal byte', () => {
    expect(speedTempoAt(400)).toEqual({ speed: 3, bpm: 200 });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd music_lib && bunx vitest run src/adapters/mod/export.test.ts`
Expected: FAIL — `Failed to resolve import "./export.js"`.

- [ ] **Step 3: Write `scoreToTracker`**

Create `music_lib/src/adapters/mod/export.ts`:

```ts
/**
 * Turning a score into a neutral tracker module.
 *
 * The exact inverse of `trackerToScore`, and it shares that file's grid:
 * `rowsPerBeat` 4 means a row is a sixteenth, so a 4/4 bar is 16 rows and a
 * 64-row pattern is four bars. Writing on the grid the importer reads is what
 * makes a round trip comparable rather than approximate.
 *
 * **Everything lossy is counted, never hidden.** A tracker row grid, a channel
 * count and a three-octave range are all narrower than a score, so an export
 * can lose material — and a file that quietly is not the music is the failure
 * mode this codebase designs against. The counts go in `TrackerFitReport` and
 * the app shows them before writing.
 *
 * Pure: no bytes, no platform, no store. `TrackerCodec.encode` turns the result
 * into a file.
 */
import type { Score, TrackerCell, TrackerModule } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import { TRACKER_LIMITS, type WritableTrackerFormat } from './limits.js';

const DEFAULT_ROWS_PER_BEAT = 4;
const ROWS_PER_PATTERN = 64;
const DEFAULT_BPM = 125;

/** What a tracker's one-byte tempo field will accept. */
const MIN_TEMPO = 32;
const MAX_TEMPO = 255;
/** Tried in order; the first that puts tempo in range wins. */
const SPEED_CHOICES = [6, 12, 3] as const;

export type TrackerExportOptions = {
  format: WritableTrackerFormat;
  /** Rows per quarter note. 4 gives sixteenths and cannot express triplets. */
  rowsPerBeat?: number;
};

export type TrackerFitReport = {
  /** Notes moved into range. */
  clampedNotes: number;
  /** Voices that did not fit the format's channel count. */
  droppedVoices: number;
  /** Notes shorter than one row, lost to the grid. */
  droppedShortNotes: number;
  /** Notes whose start moved to land on a row. */
  quantisedNotes: number;
};

export type TrackerExportResult = { module: TrackerModule; report: TrackerFitReport };

/** True when nothing was lost — the case that must not cost the user a click. */
export function isCleanFit(report: TrackerFitReport): boolean {
  return (
    report.clampedNotes === 0 &&
    report.droppedVoices === 0 &&
    report.droppedShortNotes === 0 &&
    report.quantisedNotes === 0
  );
}

/**
 * Speed and tempo for a musical BPM.
 *
 * `effectiveBpm(speed, tempo) = 6 * tempo / speed`, so at speed 6 the tempo
 * field *is* the BPM. That only works while the result fits a byte, and a score
 * may hold 20-400 BPM, so a slow score raises the speed and a fast one lowers
 * it. Every score-legal BPM lands in 32-255 under one of the three.
 */
export function speedAndTempoFor(bpm: number): { speed: number; tempo: number } {
  for (const speed of SPEED_CHOICES) {
    const tempo = Math.round((bpm * speed) / 6);
    if (tempo >= MIN_TEMPO && tempo <= MAX_TEMPO) return { speed, tempo };
  }
  // Unreachable for a valid score; clamp rather than emit an illegal byte.
  const speed = 6;
  return { speed, tempo: Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(bpm))) };
}

const emptyCell = (): TrackerCell => ({ instrument: 0, note: null });

/**
 * Move a note into range by whole octaves.
 *
 * Octaves rather than a hard clamp to the boundary: an octave displacement is
 * still the same pitch class, so a bassline pushed up an octave still reads as
 * that bassline where a note pinned to the lowest available semitone does not.
 */
function clampToRange(midi: number, lowest: number, highest: number): number {
  let value = midi;
  while (value < lowest) value += 12;
  while (value > highest) value -= 12;
  // A range narrower than an octave cannot satisfy both; prefer in-bounds.
  return Math.min(highest, Math.max(lowest, value));
}

export function scoreToTracker(score: Score, options: TrackerExportOptions): TrackerExportResult {
  const limits = TRACKER_LIMITS[options.format];
  const rowsPerBeat = options.rowsPerBeat ?? DEFAULT_ROWS_PER_BEAT;
  const ticksPerRow = score.ppq / rowsPerBeat;

  const report: TrackerFitReport = {
    clampedNotes: 0,
    droppedVoices: 0,
    droppedShortNotes: 0,
    quantisedNotes: 0,
  };

  // Channel allocation: each track gets as many channels as its widest measure
  // has voices, and they are laid out consecutively so a track's voices stay
  // together. The total is capped by the format, and the overflow is counted.
  let nextChannel = 0;
  const channelOfVoice: Array<Map<number, number>> = [];
  for (const track of score.tracks) {
    const widest = track.measures.reduce((n, m) => Math.max(n, m.voices.length), 0);
    const map = new Map<number, number>();
    for (let v = 0; v < widest; v += 1) {
      if (nextChannel < limits.channels) {
        map.set(v, nextChannel);
        nextChannel += 1;
      } else {
        report.droppedVoices += 1;
      }
    }
    channelOfVoice.push(map);
  }
  const channels = Math.max(1, Math.min(limits.channels, nextChannel));

  // How long the score runs, in rows.
  let lastTick = 0;
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      lastTick = Math.max(lastTick, measure.startTick + measure.durationTicks);
    }
  }
  const totalRows = Math.max(ROWS_PER_PATTERN, Math.ceil(lastTick / ticksPerRow));
  const patternCount = Math.ceil(totalRows / ROWS_PER_PATTERN);

  const patterns: TrackerCell[][][] = Array.from({ length: patternCount }, () =>
    Array.from({ length: ROWS_PER_PATTERN }, () => Array.from({ length: channels }, emptyCell)),
  );
  const cellAt = (row: number, channel: number): TrackerCell | null => {
    const p = Math.floor(row / ROWS_PER_PATTERN);
    if (p >= patterns.length) return null;
    return patterns[p][row % ROWS_PER_PATTERN][channel];
  };

  score.tracks.forEach((track, trackIndex) => {
    const instrument = trackIndex + 1;
    if (instrument > limits.instruments) return;
    const voiceChannels = channelOfVoice[trackIndex];

    for (const measure of track.measures) {
      measure.voices.forEach((voice, voiceIndex) => {
        const channel = voiceChannels.get(voiceIndex);
        if (channel === undefined) return; // counted as a dropped voice already
        for (const event of voice.events) {
          if (!isNoteEvent(event)) continue;

          const startRow = Math.round(event.startTick / ticksPerRow);
          const endRow = Math.round((event.startTick + event.durationTicks) / ticksPerRow);
          if (endRow <= startRow) {
            report.droppedShortNotes += 1;
            continue;
          }
          if (event.startTick % ticksPerRow !== 0) report.quantisedNotes += 1;

          const sounding = pitchToMidi(event.pitch);
          const midi = clampToRange(sounding, limits.lowestMidi, limits.highestMidi);
          if (midi !== sounding) report.clampedNotes += 1;

          const start = cellAt(startRow, channel);
          if (start) {
            start.note = midi;
            start.instrument = instrument;
          }
          // A release, unless something else already claims that row on this
          // channel — a new note supersedes the release anyway.
          const end = cellAt(endRow, channel);
          if (end && end.note === null) end.note = 'off';
        }
      });
    }
  });

  // Tempo. The first entry sets both knobs in row 0; later ones move whichever
  // the BPM needs, which `tempoChanges` on the import side reads back.
  const tempoMap = score.tempoMap.length > 0 ? score.tempoMap : [{ tick: 0, bpm: DEFAULT_BPM }];
  for (const entry of tempoMap) {
    const row = Math.round(entry.tick / ticksPerRow);
    const cell = cellAt(row, 0);
    if (!cell) continue;
    const { speed, tempo } = speedAndTempoFor(entry.bpm);
    cell.speed = speed;
    cell.bpm = tempo;
  }

  return {
    module: {
      format: options.format,
      title: score.metadata.title,
      channels,
      instruments: score.tracks
        .slice(0, limits.instruments)
        .map((track, i) => ({ index: i + 1, name: track.instrumentName || track.name })),
      order: Array.from({ length: patternCount }, (_, i) => i),
      patterns,
    },
    report,
  };
}
```

- [ ] **Step 4: Re-export from music_lib**

In `music_lib/src/index.ts`, beside the existing `adapters/mod` block (lines 89-92):

```ts
export * from './adapters/mod/limits.js';
export * from './adapters/mod/export.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd music_lib && bunx vitest run src/adapters/mod/export.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Verify by sabotage**

The fit report is the feature's whole honesty claim. Prove the counters are wired to real conditions rather than always zero:

```bash
cd music_lib
# In clampToRange, return `midi` unchanged (delete both while loops).
bunx vitest run src/adapters/mod/export.test.ts
```

Expected: the two clamp tests FAIL. Restore, then confirm green.

- [ ] **Step 7: Commit**

```bash
cd music_lib
git add src/adapters/mod/export.ts src/adapters/mod/export.test.ts src/index.ts
git commit -m "feat: scoreToTracker, with a fit report for everything the grid loses"
```

---

### Task 3: The XM writer

**Files:**

- Create: `music_io/src/shared/tracker/xm-write.ts`
- Create: `music_io/src/shared/tracker/xm-write.test.ts`
- Modify: `music_io/src/shared/mod/codec.ts`

**Interfaces:**

- Consumes: `TrackerModule` (music_types).
- Produces: `encodeXm(module: TrackerModule): ArrayBuffer`, and `SharedTrackerCodec.encode`.

The layout is `buildXm`'s, generalised — read `xm-fixture.ts` before starting.
Instruments are written in the **33-byte zero-sample form**, which `sunlight.xm`
proves real files use and `readXm` already handles.

- [ ] **Step 1: Write the failing tests**

Create `music_io/src/shared/tracker/xm-write.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TrackerCell, TrackerModule } from '@sudobility/music_types';
import { encodeXm } from './xm-write.js';
import { readXm } from './xm.js';

const cell = (over: Partial<TrackerCell> = {}): TrackerCell => ({
  instrument: 0,
  note: null,
  ...over,
});

function moduleOf(rows: TrackerCell[][][], channels: number): TrackerModule {
  return {
    format: 'xm',
    title: 'Round Trip',
    channels,
    instruments: [
      { index: 1, name: 'Acoustic Grand Piano' },
      { index: 2, name: 'Fretless Bass' },
    ],
    order: rows.map((_, i) => i),
    patterns: rows,
  };
}

/** One 64-row pattern with the given cells written at row 0. */
function oneRow(cells: TrackerCell[]): TrackerModule {
  const pattern = Array.from({ length: 64 }, (_, r) =>
    Array.from({ length: cells.length }, (_, c) => (r === 0 ? cells[c] : cell())),
  );
  return moduleOf([pattern], cells.length);
}

describe('encodeXm', () => {
  it('writes a file our own reader accepts', () => {
    const module = oneRow([cell({ note: 60, instrument: 1 })]);
    const back = readXm(encodeXm(module));
    expect(back.format).toBe('xm');
    expect(back.title).toBe('Round Trip');
  });

  it('round-trips notes and instruments', () => {
    const module = oneRow([cell({ note: 60, instrument: 1 }), cell({ note: 48, instrument: 2 })]);
    const back = readXm(encodeXm(module));
    expect(back.patterns[0][0][0]).toMatchObject({ note: 60, instrument: 1 });
    expect(back.patterns[0][0][1]).toMatchObject({ note: 48, instrument: 2 });
  });

  it('round-trips a release', () => {
    const module = oneRow([cell({ note: 'off' })]);
    expect(readXm(encodeXm(module)).patterns[0][0][0].note).toBe('off');
  });

  it('round-trips instrument names, which is what the slots are for', () => {
    const back = readXm(encodeXm(oneRow([cell({ note: 60, instrument: 1 })])));
    expect(back.instruments.map((i) => i.name)).toEqual(['Acoustic Grand Piano', 'Fretless Bass']);
  });

  it('writes zero-sample instruments, so the file carries no audio', () => {
    const bytes = new Uint8Array(encodeXm(oneRow([cell({ note: 60, instrument: 1 })])));
    // Every instrument header declares 0 samples and the 33-byte short form.
    // A 263-byte header here would mean sample slots we never fill.
    const view = new DataView(bytes.buffer);
    const headerSize = view.getUint32(60, true);
    let at = 60 + headerSize;
    // Skip the one pattern: 9-byte header, then packedSize bytes.
    at += view.getUint32(at, true) + view.getUint16(at + 7, true);
    expect(view.getUint32(at, true)).toBe(33);
    expect(view.getUint16(at + 27, true)).toBe(0);
  });

  it('round-trips speed and tempo, across two channels', () => {
    // XM has one effect column and `F` carries both knobs, so a row setting
    // speed and BPM together needs two cells. Our own importer reads tempo
    // only from cells — never from the header — so this is the path that
    // decides whether an exported tempo survives a re-import.
    const module = oneRow([cell({ note: 60, instrument: 1, speed: 6, bpm: 140 }), cell()]);
    const back = readXm(encodeXm(module));
    const row = back.patterns[0][0];
    expect(row[0].speed).toBe(6);
    expect(row[1].bpm).toBe(140);
  });

  it('still writes the header tempo, which is what a real tracker reads', () => {
    const bytes = new Uint8Array(encodeXm(oneRow([cell({ speed: 6, bpm: 140 }), cell()])));
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(76, true)).toBe(6);
    expect(view.getUint16(78, true)).toBe(140);
  });

  it('round-trips multiple patterns and the order list', () => {
    const blank = Array.from({ length: 64 }, () => [cell()]);
    const module = moduleOf([blank, blank], 1);
    const back = readXm(encodeXm(module));
    expect(back.patterns).toHaveLength(2);
    expect(back.order).toEqual([0, 1]);
  });

  it('refuses a format it does not write', () => {
    const module = { ...oneRow([cell()]), format: 'dsm' as const };
    expect(() => encodeXm(module)).toThrow(/xm/i);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd music_io && bunx vitest run src/shared/tracker/xm-write.test.ts`
Expected: FAIL — `Failed to resolve import "./xm-write.js"`.

- [ ] **Step 3: Write the encoder**

Create `music_io/src/shared/tracker/xm-write.ts`:

```ts
/**
 * Writing a FastTracker 2 module from the neutral tracker model.
 *
 * The inverse of `xm.ts`, and deliberately the layout `xm-fixture.ts` already
 * builds — that fixture's output is read by `readXm` in passing tests, so the
 * structure here is proven rather than freshly interpreted.
 *
 * **No sample data.** Instruments are written in the 33-byte zero-sample form,
 * which is structurally valid and which `sunlight.xm` shows real files using
 * for eight of its fifteen slots. The file is silent until a tracker user drops
 * samples into the named slots, which is the whole point of a notes format.
 *
 * Cells are written in the mask form (bit 7 set) throughout. The uncompressed
 * form `readXm` also accepts is never emitted: one encoding is enough, and the
 * mask form is smaller for the sparse patterns a score produces.
 */
import type { TrackerCell, TrackerModule } from '@sudobility/music_types';

const SIGNATURE = 'Extended Module: ';
const HEADER_SIZE = 276;
const INSTRUMENT_HEADER_EMPTY = 33;
const PATTERN_HEADER_SIZE = 9;

/** Note 1 is C-0, so the byte is MIDI minus eleven. 97 is a key off. */
const NOTE_BASE = 11;
const KEY_OFF = 97;
const LOWEST_MIDI = 12;
const HIGHEST_MIDI = 107;

const DEFAULT_SPEED = 6;
const DEFAULT_BPM = 125;

/** `F` carries both knobs, split at 0x20: below is speed, at or above is BPM. */
const EFFECT_F = 0x0f;

function ascii(out: Uint8Array, at: number, text: string, length: number): void {
  for (let i = 0; i < length; i += 1) {
    const code = i < text.length ? text.charCodeAt(i) : 0;
    out[at + i] = code >= 32 && code < 127 ? code : 0;
  }
}

type Effect = { effect: number; param: number };

/** One cell, in the mask form. */
function packCell(out: number[], cell: TrackerCell, effect?: Effect): void {
  let mask = 0x80;
  const note =
    cell.note === null ? undefined : cell.note === 'off' ? KEY_OFF : cell.note - NOTE_BASE;
  if (note !== undefined) mask |= 1;
  if (cell.instrument > 0) mask |= 2;
  if (effect) mask |= 8 | 16;

  out.push(mask);
  if (note !== undefined) out.push(Math.max(1, Math.min(KEY_OFF, note)));
  if (cell.instrument > 0) out.push(cell.instrument & 0xff);
  if (effect) out.push(effect.effect, effect.param);
}

/**
 * Which channel carries which effect on one row.
 *
 * `F` carries both timing knobs, split at 0x20 — below is speed, at or above is
 * BPM — so **one cell cannot express both**. Speed stays on the channel that
 * asked for it and the BPM rides the next channel that is free. With a
 * single-channel module the BPM cannot be an effect at all; the header still
 * carries the initial value, which is what a real tracker reads.
 *
 * No clamping is needed here: `speedAndTempoFor` only ever emits speeds of
 * 3/6/12 (all below 0x20) and tempos of 32-255 (all at or above it), so the
 * values already fall on the correct side of the split.
 */
function effectsForRow(row: TrackerCell[], channels: number): Array<Effect | undefined> {
  const effects: Array<Effect | undefined> = new Array(channels).fill(undefined);
  for (let c = 0; c < channels; c += 1) {
    const cell = row[c];
    if (!cell) continue;
    if (cell.speed !== undefined && effects[c] === undefined) {
      effects[c] = { effect: EFFECT_F, param: cell.speed };
    }
    if (cell.bpm !== undefined) {
      const target = effects[c] === undefined ? c : c + 1;
      if (target < channels && effects[target] === undefined) {
        effects[target] = { effect: EFFECT_F, param: cell.bpm };
      }
    }
  }
  return effects;
}

function packPattern(rows: TrackerCell[][], channels: number): Uint8Array {
  const body: number[] = [];
  for (const row of rows) {
    const effects = effectsForRow(row, channels);
    for (let c = 0; c < channels; c += 1) {
      packCell(body, row[c] ?? { instrument: 0, note: null }, effects[c]);
    }
  }
  return new Uint8Array(body);
}

export function encodeXm(module: TrackerModule): ArrayBuffer {
  if (module.format !== 'xm') {
    throw new Error(`encodeXm writes xm, not "${module.format}"`);
  }

  const channels = Math.max(1, module.channels);
  const packed = module.patterns.map((rows) => packPattern(rows, channels));

  // Row 0's knobs become the header defaults, which is where a tracker reads
  // the starting tempo from.
  const first = module.patterns[0]?.[0] ?? [];
  const initialSpeed = first.find((c) => c?.speed !== undefined)?.speed ?? DEFAULT_SPEED;
  const initialBpm = first.find((c) => c?.bpm !== undefined)?.bpm ?? DEFAULT_BPM;

  const patternBytes = packed.reduce((n, p) => n + PATTERN_HEADER_SIZE + p.length, 0);
  const instrumentBytes = module.instruments.length * INSTRUMENT_HEADER_EMPTY;
  const out = new Uint8Array(60 + HEADER_SIZE + patternBytes + instrumentBytes);
  const view = new DataView(out.buffer);

  ascii(out, 0, SIGNATURE, 17);
  ascii(out, 17, module.title, 20);
  out[37] = 0x1a;
  ascii(out, 38, 'ScoreSmith', 20);
  view.setUint16(58, 0x0104, true);
  view.setUint32(60, HEADER_SIZE, true);
  view.setUint16(64, module.order.length, true);
  view.setUint16(68, channels, true);
  view.setUint16(70, module.patterns.length, true);
  view.setUint16(72, module.instruments.length, true);
  view.setUint16(76, initialSpeed, true);
  view.setUint16(78, initialBpm, true);
  module.order.forEach((value, i) => {
    out[80 + i] = value & 0xff;
  });

  let at = 60 + HEADER_SIZE;
  packed.forEach((data, i) => {
    view.setUint32(at, PATTERN_HEADER_SIZE, true);
    out[at + 4] = 0;
    view.setUint16(at + 5, module.patterns[i].length, true);
    view.setUint16(at + 7, data.length, true);
    out.set(data, at + PATTERN_HEADER_SIZE);
    at += PATTERN_HEADER_SIZE + data.length;
  });

  for (const instrument of module.instruments) {
    view.setUint32(at, INSTRUMENT_HEADER_EMPTY, true);
    ascii(out, at + 4, instrument.name, 22);
    out[at + 26] = 0;
    view.setUint16(at + 27, 0, true); // no samples: a notes format carries none
    at += INSTRUMENT_HEADER_EMPTY;
  }

  return out.buffer;
}

export { LOWEST_MIDI as XM_LOWEST_MIDI, HIGHEST_MIDI as XM_HIGHEST_MIDI };
```

- [ ] **Step 4: Run the tests**

Run: `cd music_io && bunx vitest run src/shared/tracker/xm-write.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Implement `encode` on the codec**

In `music_io/src/shared/mod/codec.ts`:

```ts
import { encodeXm } from '../tracker/xm-write.js';
```

```ts
  /**
   * Writes a module out in the format it names.
   *
   * Only the four formats export supports are written; DSM and MPTM are
   * import-only by design, and throwing names the format rather than silently
   * writing a near neighbour the user did not ask for.
   */
  encode(module: TrackerModule): ArrayBuffer {
    if (module.format === 'xm') return encodeXm(module);
    throw new Error(`Writing "${module.format}" is not supported yet`);
  }
```

- [ ] **Step 6: Run the whole music_io suite**

Run: `cd music_io && bun run verify`
Expected: PASS. The typecheck failure Task 1 introduced is now closed.

- [ ] **Step 7: Commit**

```bash
cd music_io
git add src/shared/tracker/xm-write.ts src/shared/tracker/xm-write.test.ts src/shared/mod/codec.ts
git commit -m "feat: write XM modules, notes only, with named empty instrument slots"
```

---

### Task 4: The app surface

**Files:**

- Create: `music_app/src/components/dialogs/TrackerFitDialog.tsx`
- Modify: `music_app/src/components/layout/AppLayout.tsx`
- Modify: `music_app/CLAUDE.md`, `music_app/docs/spec.md`

**Interfaces:**

- Consumes: `scoreToTracker`, `isCleanFit`, `TrackerFitReport` (music_lib); `io.modCodec.encode` (music_io).

- [ ] **Step 1: Write the fit dialog**

Create `music_app/src/components/dialogs/TrackerFitDialog.tsx`:

```tsx
/**
 * What an export to this format will lose, and a chance to back out.
 *
 * Shown **only** when something was actually lost — a clean fit writes the file
 * with no click, which is the common case for XM and IT. The numbers are named
 * rather than summarised: "some notes were changed" is not something a user can
 * act on, where "12 notes outside ProTracker's range were moved" tells them to
 * try XM instead.
 */
import { FormModal } from '@sudobility/components';
import type { TrackerFitReport } from '@sudobility/music_lib';

export type TrackerFitDialogProps = {
  open: boolean;
  format: string;
  report: TrackerFitReport;
  onConfirm: () => void;
  onCancel: () => void;
};

function lines(report: TrackerFitReport, format: string): string[] {
  const out: string[] = [];
  if (report.clampedNotes > 0) {
    out.push(
      `${report.clampedNotes} note${report.clampedNotes === 1 ? '' : 's'} outside ${format}'s range were moved by whole octaves.`,
    );
  }
  if (report.droppedVoices > 0) {
    out.push(
      `${report.droppedVoices} voice${report.droppedVoices === 1 ? '' : 's'} did not fit ${format}'s channel count and will be missing.`,
    );
  }
  if (report.droppedShortNotes > 0) {
    out.push(
      `${report.droppedShortNotes} note${report.droppedShortNotes === 1 ? '' : 's'} shorter than one row were dropped.`,
    );
  }
  if (report.quantisedNotes > 0) {
    out.push(
      `${report.quantisedNotes} note${report.quantisedNotes === 1 ? '' : 's'} moved slightly to land on the row grid.`,
    );
  }
  return out;
}

export function TrackerFitDialog({
  open,
  format,
  report,
  onConfirm,
  onCancel,
}: TrackerFitDialogProps) {
  return (
    <FormModal
      open={open}
      title={`Export as ${format}`}
      onClose={onCancel}
      closeAriaLabel="Close dialog"
      actions={[
        { label: 'Cancel', onClick: onCancel },
        { label: 'Export anyway', onClick: onConfirm },
      ]}
    >
      <div className="space-y-3 text-sm">
        <p>This score does not fit {format} exactly:</p>
        <ul className="list-disc space-y-1 pl-5">
          {lines(report, format).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          The file carries notes only — its instrument slots are named but empty, so it will be
          silent until you add samples in a tracker.
        </p>
      </div>
    </FormModal>
  );
}
```

- [ ] **Step 2: Wire the handler**

In `AppLayout.tsx`, beside `handleExportMidi`. Note the order: scope first (it
changes the fit), then compute, then interrupt only if needed.

```tsx
const [pendingModule, setPendingModule] = useState<{
  format: WritableTrackerFormat;
  report: TrackerFitReport;
  write: () => Promise<void>;
} | null>(null);

/**
 * Export a tracker module.
 *
 * Scope runs first because the fit depends on it: exporting visible tracks
 * only may bring a score within a channel limit that all tracks exceed.
 */
const handleExportModule = (format: WritableTrackerFormat): void => {
  withExportScope(async (target) => {
    try {
      const { module, report } = scoreToTracker(target, { format });
      const write = async (): Promise<void> => {
        const bytes = getAppServices().io.modCodec.encode(module);
        await getAppServices().io.fileExporter.save(
          `${midiSafeFilename(target.metadata.title)}.${format}`,
          new Uint8Array(bytes),
          'application/octet-stream',
        );
      };
      // A clean fit must not cost a click.
      if (isCleanFit(report)) {
        await write();
        return;
      }
      setPendingModule({ format, report, write });
    } catch (err) {
      reportError(err, { context: `${format.toUpperCase()} export failed`, store });
    }
  });
  exportMenu.setOpen(false);
};
```

Render the dialog beside the other modals:

```tsx
{
  pendingModule && (
    <TrackerFitDialog
      open
      format={pendingModule.format.toUpperCase()}
      report={pendingModule.report}
      onCancel={() => setPendingModule(null)}
      onConfirm={() => {
        const pending = pendingModule;
        setPendingModule(null);
        void pending.write().catch((err) => {
          reportError(err, { context: 'Module export failed', store });
        });
      }}
    />
  );
}
```

- [ ] **Step 3: Add the menu entry**

Beside the MusicXML entry (around line 715), grouped with the notes formats:

```tsx
<MenuItem onClick={() => handleExportModule('xm')}>XM Module…</MenuItem>
```

Match the surrounding entries' component and props exactly — read lines 705-725
before writing this, as the menu item shape is local to that file.

- [ ] **Step 4: Write a component test**

Add to `music_app/src/components/layout/AppLayout.test.tsx`:

```tsx
it('writes an XM file without a dialog when the score fits', async () => {
  // The clean-fit path must not cost a click: it is the common case.
  installTestAppServices();
  const save = vi.fn().mockResolvedValue(undefined);
  getAppServices().io.fileExporter.save = save;
  renderAppLayout();
  await userEvent.click(screen.getByRole('button', { name: /export/i }));
  await userEvent.click(screen.getByText(/XM Module/i));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).toMatch(/\.xm$/);
});
```

Adjust the render helper and queries to whatever `AppLayout.test.tsx` already
uses — read the file's existing export tests first and copy their setup rather
than inventing one.

- [ ] **Step 5: Verify**

Run: `cd music_app && bun run verify`
Expected: PASS.

- [ ] **Step 6: Update the docs**

In `music_app/CLAUDE.md`, the tracker bullet currently ends `Import only, for
now — export is designed but not built.` Replace that sentence with:

```
**Export writes notes only** (`scoreToTracker` in music_lib → `modCodec.encode` in music_io). No sample data: a module is a notes format under the notes/audio split, so its instrument slots are named after the track's instrument and left empty, and the file is silent until a tracker user fills them — the export dialog says so. Three things are lossy and all three are counted into a `TrackerFitReport` rather than hidden: the row grid (a row is a sixteenth, so anything shorter is dropped), the channel count (the sum of each track's widest voice count, capped per format), and the note range (MOD's three octaves are MIDI 36-71, anchored on `period.ts`'s reference period so import and export agree). A clean fit writes with no extra click; anything lost shows the numbers first. Scope is chosen **before** the fit is computed, because exporting visible tracks only may bring a score within a channel limit all tracks exceed. **DSM and MPTM are import-only** — nothing reads DSM that does not read a better format, and OpenMPT reads IT natively.
```

In `music_app/docs/spec.md`, add XM to the export formats list beside MIDI and
MusicXML.

- [ ] **Step 7: Manual check — the one no test replaces**

Export a score as XM, open it in OpenMPT, and confirm the notes appear on the
rows and channels you expect and the instrument slots carry their names. A
header field can be structurally valid, round-trip through our own reader, and
still be wrong in a way only a real tracker shows.

- [ ] **Step 8: Commit and push**

```bash
cd music_app && ./scripts/push_all.sh
```

---

## Self-Review Notes

**Spec coverage.** §1 (no samples, named slots, UI says so) → Tasks 3, 4. §2
(three lossy mappings) → Task 2, all three counted. §3 (architecture) → Tasks
2, 3, split exactly as the spec draws it. §4 (flow, scope first) → Task 4. §5
(limits) → Task 1, all four formats. §6 (app surface) → Task 4. §7 (testing) →
round trip in Task 3, fit reporting in Task 2, byte structure in Task 3, manual
check in Task 4 Step 7. §8 (docs) → Task 4 Step 6.

**Deliberately deferred to the per-format plans**: the MOD, S3M and IT writers.
`encode` throws for them by name, so the failure is legible rather than a
mis-written file. The limits table lands whole in Task 1 regardless, because
`scoreToTracker` reports against a format without needing its writer — which is
why Task 2 can test MOD's clamping and channel limits with only XM written.

**Two known limits, both stated rather than papered over:**

- **A single-channel module cannot express a BPM change as an effect.** XM has
  one effect column and `F` carries both knobs, so speed and BPM need two
  cells; with one channel only the speed fits. The header still carries the
  initial tempo, which is what a real tracker reads — only a re-import through
  our own model, which never reads the header, would see 125. Every score with
  a second voice or a second track has the channel to spare.
- **Round trip is exact only for 4/4.** `trackerToScore` assumes 4/4 and
  `ROWS_PER_BEAT = 4` when rebuilding measures, so a 3/4 score exports correctly
  but re-imports with different barlines. The notes and their timing survive;
  the barlines do not. This is an import-side assumption, not a new one.

**Type consistency.** `scoreToTracker(score, options)` returns
`{ module, report }` as §3 specifies. `TrackerFitReport`'s four fields match the
spec's block verbatim. `WritableTrackerFormat` narrows `TrackerFormat` rather
than duplicating it, so DSM and MPTM are unrepresentable in an export path at
the type level rather than by a runtime check alone.
