# Tracker Import Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MOD-shaped `ModFile` with a format-neutral `TrackerModule`, move MOD onto it, and rewrite `modToScore` as `trackerToScore` — fixing the 554 `measure-underfull` warnings a real module currently produces.

**Architecture:** `TrackerModule` in `music_types` carries MIDI note numbers rather than Amiga periods, per-pattern row counts, an instrument layer, explicit note-off, and normalised `speed`/`bpm` — so no downstream code branches on format. The MOD reader converts periods at decode time. `trackerToScore` keeps `modToScore`'s musical decisions and gains rest-filling and note-off handling.

**Tech Stack:** TypeScript (strict, ESM, extensionless relative imports built by `tsc`), Vitest.

## Global Constraints

- **Repos, in this order:** `music_types` → `music_io` → `music_lib` → `music_app`. Each has `bun run test` / `typecheck` / `lint` / `verify`.
- **Relative imports carry a `.js` extension** even from `.ts` files. House style across `@sudobility`; do not "fix" it.
- **Cross-repo propagation:** after changing a library run `bun run clean && bun run build`, `rsync -a --delete dist/ ../<consumer>/node_modules/@sudobility/<pkg>/dist/`, then `rm -rf ../music_app/node_modules/.vite`. Vite pre-bundles dependencies, so without that removal the consumer keeps running the old code while the file on disk is right.
- **`music_lib` is platform-free.** No React, no DOM, no `import.meta.env`, no byte handling.
- **`music_io` does bytes, `music_lib` does music.** The codec returns raw data; the mapping to the score model happens in `music_lib`. This split is why both halves are testable without the other.
- **No new formats in this plan.** MOD only. The four new decoders are separate plans; this one exists to make them cheap.
- **Verify by sabotage.** After each task's tests pass, break the implementation line the test targets, confirm that test fails, restore.
- **Spec:** `docs/superpowers/specs/2026-08-17-tracker-formats-design.md`, §1-§4 and §8 steps 1-2.
- **Do not commit manually.** When a task says deploy, run `music_app/scripts/push_all.sh`.

---

## File Structure

| Repo | File | Responsibility | Change |
| --- | --- | --- | --- |
| types | `src/platform/mod.ts` | tracker model + codec contract | Rewrite as `TrackerModule` / `TrackerCodec` |
| io | `src/shared/mod/read.ts` | MOD byte reading | Modify: emit `TrackerCell`, convert periods |
| io | `src/shared/mod/period.ts` | **new** — Amiga period → MIDI | Create (moved from `music_lib`) |
| io | `src/shared/mod/codec.ts` | the `TrackerCodec` implementation | Modify: rename, detect magic |
| io | `src/shared/mod/fixture.ts` | hand-built MOD buffer for tests | Modify: unchanged bytes, new expectations |
| lib | `src/adapters/mod/import.ts` | `modToScore` | Rewrite as `trackerToScore` |
| lib | `src/adapters/mod/fill.ts` | **new** — gap filling with rests | Create |
| lib | `src/adapters/mod/timing.ts` | tempo arithmetic | Modify: drop `periodToMidi`, read neutral fields |
| lib | `src/adapters/mod/types.ts` | re-export | Modify: re-export `TrackerModule` |
| app | `src/features/projects/DashboardPage.tsx:348` | import handler | Modify: `trackerToScore` |

---

### Task 1: The neutral model

**Repo:** `music_types`

**Files:**
- Modify: `src/platform/mod.ts`

**Interfaces:**
- Produces: `TrackerFormat`, `TrackerInstrument`, `TrackerCell`, `TrackerModule`, `TrackerCodec` — all exported from the package root. `ModFile`, `ModCell`, `ModSample` and `ModCodec` are **deleted**, not deprecated: there is one consumer of each and leaving both would mean two models to keep in step.

- [ ] **Step 1: Replace the file's contents**

`src/platform/mod.ts` becomes:

```ts
/**
 * A format-neutral model of a tracker module.
 *
 * Was `ModFile`, shaped by exactly what ProTracker stores. That shape does not
 * survive contact with the rest of the family: only MOD uses Amiga periods,
 * only MOD has fixed 64-row patterns, and only MOD lets a sample stand in for
 * an instrument. So the model states what every format agrees on and each
 * decoder normalises its own quirks behind it — which is what keeps
 * `trackerToScore` free of format branches.
 *
 * Decoding stops here deliberately. Turning this into a score is musical work
 * and lives in music_lib; only the byte reading is platform-shaped, and even
 * that is shared by all three `MusicIo` implementations.
 */

export type TrackerFormat = 'mod' | 's3m' | 'xm' | 'it' | 'dsm' | 'mptm';

/** One instrument slot. In MOD/S3M/DSM a sample *is* the instrument; XM, IT and MPTM put a layer above. */
export type TrackerInstrument = { index: number; name: string };

/**
 * One channel's cell in one row.
 *
 * `note` is a MIDI note number rather than a period: MOD is the only format
 * that stores periods, so converting in its decoder keeps the approximation
 * that conversion involves in one place instead of leaking into shared code.
 *
 * `effect`/`param` are deliberately absent. Notation import reads exactly one
 * thing from the effect column — speed and tempo — and *which* effect carries
 * it is format knowledge (XM splits `F` at 0x20; S3M and IT use `A` and `T`).
 * Each decoder normalises to `speed`/`bpm`, so nothing downstream branches.
 */
export type TrackerCell = {
  /** 0 means "keep whatever this channel was already playing". */
  instrument: number;
  /** MIDI note number, `'off'` for an explicit release or cut, `null` for an empty cell. */
  note: number | 'off' | null;
  /** Ticks per row, where this cell changes it. */
  speed?: number;
  /** Beats per minute, where this cell changes it. */
  bpm?: number;
  /** `Dxx` — this row ends the pattern early. */
  patternBreak?: boolean;
};

export type TrackerModule = {
  format: TrackerFormat;
  title: string;
  channels: number;
  instruments: TrackerInstrument[];
  /** Pattern indices in playback order; a pattern played three times appears three times. */
  order: number[];
  /** `patterns[p][row][channel]`. Row count varies per pattern — MOD is always 64, IT allows 200. */
  patterns: TrackerCell[][][];
};

/**
 * Reading a tracker module.
 *
 * A capability for surface consistency — the app reaches every file format
 * through `getAppServices().io` — even though nothing about parsing is
 * platform-bound. All three implementations delegate to one shared module.
 */
export interface TrackerCodec {
  /** Sniffs the format from the bytes and decodes it. Throws on anything unrecognised, rather than returning a garbage module that looks imported. */
  decode(bytes: ArrayBuffer): TrackerModule;
}
```

- [ ] **Step 2: Check what the package root exports**

Run: `grep -n "platform/mod" src/index.ts`
If it re-exports by name rather than `export *`, update the names there too.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS — `music_types` has no internal consumers of these types.

- [ ] **Step 4: Build and propagate**

```bash
bun run clean && bun run build
for c in music_io music_lib music_app; do rsync -a --delete dist/ ../$c/node_modules/@sudobility/music_types/dist/; done
rm -rf ../music_app/node_modules/.vite
```

Expected: `music_io` and `music_lib` now fail typecheck. That is the next two tasks.

---

### Task 2: MOD reads into the neutral model

**Repo:** `music_io`

**Files:**
- Create: `src/shared/mod/period.ts`, `src/shared/mod/period.test.ts`
- Modify: `src/shared/mod/read.ts`, `src/shared/mod/read.test.ts`, `src/shared/mod/codec.ts`

**Interfaces:**
- Consumes: `TrackerCell`, `TrackerModule`, `TrackerCodec` from Task 1.
- Produces: `periodToMidi(period: number): number | null` from `src/shared/mod/period.js`; `readMod(buffer: ArrayBuffer): TrackerModule`; `SharedTrackerCodec` implementing `TrackerCodec`, replacing `SharedModCodec`.

**Why `periodToMidi` moves repos.** It currently lives in `music_lib/src/adapters/mod/timing.ts` because it is a musical conversion. Under the neutral model the decoder is the only thing that ever sees a period, so keeping it in `music_lib` would mean exporting it back for one caller. Moving it is what makes "only MOD has periods" true at the boundary.

- [ ] **Step 1: Write the failing period test**

Create `src/shared/mod/period.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { periodToMidi } from './period.js';

describe('periodToMidi', () => {
  it('maps ProTracker C-1 to MIDI 36', () => {
    expect(periodToMidi(856)).toBe(36);
  });

  it('maps an octave up to twelve semitones up', () => {
    expect(periodToMidi(428)).toBe(48);
  });

  it('treats a zero or negative period as no note', () => {
    expect(periodToMidi(0)).toBeNull();
    expect(periodToMidi(-1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test -- src/shared/mod/period.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `src/shared/mod/period.ts`:

```ts
/**
 * Amiga period values to MIDI note numbers.
 *
 * Lives here rather than in music_lib because the MOD decoder is the only
 * thing that ever sees a period: every other tracker format stores note
 * numbers directly. Converting at the boundary is what keeps "periods are a
 * ProTracker detail" true.
 *
 * **Known limitation:** this computes from a reference period rather than
 * ProTracker's own table, which finetune shifts — so a real module can land a
 * note or two differently than a tracker would show.
 */

/** ProTracker's C-1 period, taken as MIDI 36 (C2). */
const REFERENCE_PERIOD = 856;
const REFERENCE_MIDI = 36;

/** The pitch a period sounds, or null for "no new note". */
export function periodToMidi(period: number): number | null {
  if (period <= 0) return null;
  return Math.round(REFERENCE_MIDI + 12 * Math.log2(REFERENCE_PERIOD / period));
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- src/shared/mod/period.test.ts`
Expected: PASS.

- [ ] **Step 5: Make `readMod` emit `TrackerCell`s**

In `src/shared/mod/read.ts`:

- Change the import to `import type { TrackerCell, TrackerInstrument, TrackerModule } from '@sudobility/music_types';` and add `import { periodToMidi } from './period.js';`.
- Change the return type to `TrackerModule`.
- Where a cell is currently built as `{ sample, period, effect, param }`, build instead:

```ts
const cell: TrackerCell = {
  instrument: sample,
  note: periodToMidi(period),
};
// Effect F: at or below 0x1f the parameter is speed, above it tempo.
if (effect === 0xf) {
  if (param <= 0x1f) cell.speed = param;
  else cell.bpm = param;
}
// Effect D: pattern break — this row ends the pattern.
if (effect === 0xd) cell.patternBreak = true;
```

- Where the sample list is built, produce `TrackerInstrument[]` (the shape is identical: `{ index, name }`).
- Return `{ format: 'mod', title, channels, instruments, order, patterns }`.

MOD has no note-off, so `note` is never `'off'` here — a note runs until its channel plays again, which `trackerToScore` handles as the MOD-shaped fallback it always was.

- [ ] **Step 6: Update `read.test.ts` expectations**

The fixture bytes do not change; the shape they decode into does. Replace assertions on `cell.period` with `cell.note` (a MIDI number), and `cell.sample` with `cell.instrument`. Add one case asserting a speed change is normalised:

```ts
it('normalises effect F into speed or bpm rather than leaving raw effect data', () => {
  const mod = readMod(buildFixture());
  const cells = mod.patterns.flat(2);
  // The fixture sets F06 on the first row — speed 6, the ProTracker default.
  expect(cells.some((c) => c.speed === 6)).toBe(true);
});
```

Read `src/shared/mod/fixture.ts` first and adjust that expectation to whatever effect the fixture actually writes; if it writes none, add `F06` to row 0 channel 0 and say so in a comment.

- [ ] **Step 7: Rename the codec**

In `src/shared/mod/codec.ts`, rename `SharedModCodec` to `SharedTrackerCodec` and have it implement `TrackerCodec`. Its `decode` still delegates to `readMod`. Update `src/web/index.ts`, `src/rn/index.ts` and `src/mocks/index.ts` — grep for `SharedModCodec` and `modCodec` to find every site.

Keep the `MusicIo` property named `modCodec` for now; renaming it to `trackerCodec` touches `music_app` and belongs with the app-surface task in a later plan. Add a comment saying so.

- [ ] **Step 8: Run the suite and verify**

Run: `bun run verify`
Expected: PASS.

- [ ] **Step 9: Sabotage check**

Change `periodToMidi`'s `REFERENCE_MIDI` from 36 to 37. Expected: "maps ProTracker C-1 to MIDI 36" FAILS. Restore, re-run, confirm green.

- [ ] **Step 10: Build and propagate**

```bash
bun run clean && bun run build
for c in music_lib music_app; do rsync -a --delete dist/ ../$c/node_modules/@sudobility/music_io/dist/; done
rm -rf ../music_app/node_modules/.vite
```

---

### Task 3: Gap filling

**Repo:** `music_lib`

**Files:**
- Create: `src/adapters/mod/fill.ts`, `src/adapters/mod/fill.test.ts`

**Interfaces:**
- Consumes: `decomposeDuration(ticks, ppq)` from `src/domain/time/durations.js`, `createId` from `src/domain/score/ids.js`.
- Produces:

```ts
export function fillVoiceWithRests(
  events: NoteEvent[],
  measureStartTick: number,
  measureDurationTicks: number,
  ppq: number,
  trackId: UUID,
  voiceId: UUID,
): MusicalEvent[];
```

**Why this is its own module.** It is the fix for the 554 warnings and it is pure arithmetic over an event list — no score model, no bytes. Testing it directly is far easier than asserting warning counts through a whole import, and every future decoder inherits it.

A gap may not be a single renderable duration, which is what `decomposeDuration` is for: it greedily splits a tick span into the largest drawable values.

- [ ] **Step 1: Write the failing tests**

Create `src/adapters/mod/fill.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent } from '@sudobility/music_types';
import { fillVoiceWithRests } from './fill.js';

const PPQ = 480;
const BAR = PPQ * 4;

function note(startTick: number, durationTicks: number): NoteEvent {
  return {
    id: `n${startTick}`,
    pitch: { step: 'C', accidental: 0, octave: 4 },
    startTick,
    durationTicks,
    velocity: 80,
    voiceId: 'v',
    trackId: 't',
  };
}

/** What the validator checks: the events must tile the measure exactly. */
function covers(events: ReturnType<typeof fillVoiceWithRests>, start: number, duration: number): boolean {
  let at = start;
  for (const e of events) {
    if (e.startTick !== at) return false;
    at += e.durationTicks;
  }
  return at === start + duration;
}

describe('fillVoiceWithRests', () => {
  it('fills a leading gap', () => {
    const out = fillVoiceWithRests([note(PPQ, PPQ)], 0, BAR, PPQ, 't', 'v');
    expect(covers(out, 0, BAR)).toBe(true);
    expect(isNoteEvent(out[0])).toBe(false);
  });

  it('fills a gap between notes', () => {
    const out = fillVoiceWithRests([note(0, PPQ), note(PPQ * 2, PPQ)], 0, BAR, PPQ, 't', 'v');
    expect(covers(out, 0, BAR)).toBe(true);
    expect(out.filter((e) => !isNoteEvent(e)).length).toBeGreaterThan(0);
  });

  it('fills a trailing gap', () => {
    const out = fillVoiceWithRests([note(0, PPQ)], 0, BAR, PPQ, 't', 'v');
    expect(covers(out, 0, BAR)).toBe(true);
  });

  it('returns one full-measure rest for an empty voice', () => {
    const out = fillVoiceWithRests([], 0, BAR, PPQ, 't', 'v');
    expect(covers(out, 0, BAR)).toBe(true);
    expect(out.every((e) => !isNoteEvent(e))).toBe(true);
  });

  it('leaves an already-full voice alone', () => {
    const out = fillVoiceWithRests([note(0, BAR)], 0, BAR, PPQ, 't', 'v');
    expect(out).toHaveLength(1);
    expect(isNoteEvent(out[0])).toBe(true);
  });

  it('works on a measure that does not start at tick 0', () => {
    const out = fillVoiceWithRests([note(BAR + PPQ, PPQ)], BAR, BAR, PPQ, 't', 'v');
    expect(covers(out, BAR, BAR)).toBe(true);
  });

  it('splits a gap that is not one renderable duration', () => {
    // 5 sixteenths: not a single drawable value, so it must come out as several.
    const gap = (PPQ / 4) * 5;
    const out = fillVoiceWithRests([note(gap, BAR - gap)], 0, BAR, PPQ, 't', 'v');
    expect(covers(out, 0, BAR)).toBe(true);
    expect(out.filter((e) => !isNoteEvent(e)).length).toBeGreaterThan(1);
  });

  it('gives every event the voice and track it was told', () => {
    const out = fillVoiceWithRests([note(PPQ, PPQ)], 0, BAR, PPQ, 'track-x', 'voice-y');
    for (const e of out) {
      expect(e.trackId).toBe('track-x');
      expect(e.voiceId).toBe('voice-y');
    }
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- src/adapters/mod/fill.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/adapters/mod/fill.ts`:

```ts
/**
 * Filling a voice's gaps with rests.
 *
 * A voice must cover its measure exactly or the notation is wrong — a bar that
 * carries 1200 ticks of a 1920-tick measure renders short. The module importer
 * did not do this, which produced 554 `measure-underfull` warnings on a real
 * module and bars that visibly did not add up.
 *
 * Pure arithmetic over an event list: no score model, no bytes, and every
 * tracker format's importer gets it for free.
 */
import { decomposeDuration } from '../../domain/time/durations.js';
import { createId } from '../../domain/score/ids.js';
import type { MusicalEvent, NoteEvent, UUID } from '@sudobility/music_types';

/**
 * `events` with rests inserted before, between and after them, so the result
 * tiles `[measureStartTick, measureStartTick + measureDurationTicks)` exactly.
 *
 * `events` must be sorted by `startTick` and must not overlap — which is what
 * the caller's voice allocation already guarantees.
 */
export function fillVoiceWithRests(
  events: NoteEvent[],
  measureStartTick: number,
  measureDurationTicks: number,
  ppq: number,
  trackId: UUID,
  voiceId: UUID,
): MusicalEvent[] {
  const measureEnd = measureStartTick + measureDurationTicks;
  const out: MusicalEvent[] = [];
  let at = measureStartTick;

  /** A gap may be longer than any single drawable value, so it can become several rests. */
  const addRests = (from: number, to: number): void => {
    for (const ticks of decomposeDuration(to - from, ppq)) {
      out.push({ id: createId(), startTick: from, durationTicks: ticks, voiceId, trackId });
      from += ticks;
    }
  };

  for (const event of events) {
    if (event.startTick > at) addRests(at, event.startTick);
    out.push({ ...event, voiceId, trackId });
    at = event.startTick + event.durationTicks;
  }
  if (at < measureEnd) addRests(at, measureEnd);

  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/adapters/mod/fill.test.ts`
Expected: PASS.

- [ ] **Step 5: Sabotage check**

Delete the `if (at < measureEnd) addRests(at, measureEnd);` line. Expected: "fills a trailing gap" FAILS. Restore.

---

### Task 4: `trackerToScore`

**Repo:** `music_lib`

**Files:**
- Modify: `src/adapters/mod/import.ts`, `src/adapters/mod/import.test.ts`, `src/adapters/mod/timing.ts`, `src/adapters/mod/timing.test.ts`, `src/adapters/mod/types.ts`
- Modify: `src/index.ts` (export rename)

**Interfaces:**
- Consumes: `fillVoiceWithRests` (Task 3), `TrackerModule`/`TrackerCell` (Task 1).
- Produces: `trackerToScore(module: TrackerModule): Score`, replacing `modToScore`. `periodToMidi` is **no longer exported from `music_lib`** — it moved to `music_io` in Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `src/adapters/mod/import.test.ts`:

```ts
describe('trackerToScore: every voice covers its measure', () => {
  it('produces a score with no validation errors or underfull warnings', () => {
    // The defect this replaces: notes were placed without rests around them, so
    // a bar carrying 1200 ticks of 1920 rendered short. A real module produced
    // 554 such warnings.
    const score = trackerToScore(moduleWithGaps());
    const issues = validateScore(score);
    expect(issues.filter((i) => i.code === 'measure-underfull')).toEqual([]);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('still places the notes it was given', () => {
    const score = trackerToScore(moduleWithGaps());
    const notes = allNotes(score);
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe('trackerToScore: note-off', () => {
  it('ends a note at an explicit note-off rather than at the next note', () => {
    const module = moduleWith([
      [{ instrument: 1, note: 60 }],
      [{ instrument: 0, note: null }],
      [{ instrument: 0, note: 'off' }],
      [{ instrument: 0, note: null }],
    ]);
    const score = trackerToScore(module);
    const [first] = allNotes(score);
    // Two rows long: started row 0, released row 2.
    expect(first.durationTicks).toBe(2 * (score.ppq / 4));
  });

  it('runs a note to the next note when the format has no note-off, as MOD does', () => {
    const module = moduleWith([
      [{ instrument: 1, note: 60 }],
      [{ instrument: 0, note: null }],
      [{ instrument: 0, note: null }],
      [{ instrument: 1, note: 62 }],
    ]);
    const score = trackerToScore(module);
    const [first] = allNotes(score);
    expect(first.durationTicks).toBe(3 * (score.ppq / 4));
  });
});

describe('trackerToScore: pattern break', () => {
  it('ends a pattern early on Dxx rather than running all 64 rows', () => {
    const short = moduleWith([
      [{ instrument: 1, note: 60 }],
      [{ instrument: 0, note: null, patternBreak: true }],
      [{ instrument: 1, note: 62 }],
    ]);
    const full = moduleWith([
      [{ instrument: 1, note: 60 }],
      [{ instrument: 0, note: null }],
      [{ instrument: 1, note: 62 }],
    ]);
    expect(allNotes(trackerToScore(short)).length).toBeLessThan(
      allNotes(trackerToScore(full)).length,
    );
  });
});
```

Add these two builders at the top of the file:

```ts
/** A one-pattern, one-channel module from a list of rows. */
function moduleWith(rows: TrackerCell[][]): TrackerModule {
  return {
    format: 'mod',
    title: 'Test',
    channels: 1,
    instruments: [{ index: 1, name: 'Lead' }],
    order: [0],
    patterns: [rows],
  };
}

/** A module whose notes leave holes: one on row 0, one on row 8, nothing between. */
function moduleWithGaps(): TrackerModule {
  const rows: TrackerCell[][] = Array.from({ length: 16 }, () => [{ instrument: 0, note: null }]);
  rows[0] = [{ instrument: 1, note: 60 }];
  rows[1] = [{ instrument: 0, note: 'off' }];
  rows[8] = [{ instrument: 1, note: 64 }];
  rows[9] = [{ instrument: 0, note: 'off' }];
  return moduleWith(rows);
}
```

and import what they need: `validateScore` from `../../domain/validation/validator.js`, `allNotes` from `../../domain/score/queries.js`, and the tracker types from `@sudobility/music_types`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- src/adapters/mod/import.test.ts`
Expected: FAIL — `trackerToScore` is not defined.

- [ ] **Step 3: Rewrite `placeNotes` for the neutral cell**

In `src/adapters/mod/import.ts`, replace `placeNotes` with:

```ts
type Placed = { instrument: number; startRow: number; endRow: number; midi: number };

/** Rows in playback order, honouring `patternBreak`. */
function flattenRows(module: TrackerModule): TrackerCell[][] {
  const flat: TrackerCell[][] = [];
  for (const patternIndex of module.order) {
    const pattern = module.patterns[patternIndex];
    if (!pattern) continue;
    for (const row of pattern) {
      flat.push(row);
      // Dxx ends this pattern here; the order list continues with the next.
      if (row.some((cell) => cell.patternBreak)) break;
    }
  }
  return flat;
}

/**
 * Every note in playback order, with the row each ends on.
 *
 * A channel holds one note at a time. It ends when that channel plays another
 * note, or on an explicit note-off — which MOD never sends, so there the first
 * rule is the only one, exactly as it always was.
 */
function placeNotes(module: TrackerModule): Placed[] {
  const flat = flattenRows(module);
  const placed: Placed[] = [];
  const open = new Map<number, Placed>();

  flat.forEach((cells, row) => {
    cells.forEach((cell, channel) => {
      if (cell.note === null) return;

      const previous = open.get(channel);
      if (previous) previous.endRow = row;
      open.delete(channel);

      if (cell.note === 'off') return;

      const note: Placed = {
        instrument: cell.instrument,
        startRow: row,
        endRow: row + 1,
        midi: cell.note,
      };
      open.set(channel, note);
      placed.push(note);
    });
  });

  return placed;
}
```

- [ ] **Step 4: Point the rest of the function at the new names**

Rename `modToScore` to `trackerToScore` taking `module: TrackerModule`. Replace every `n.sample` with `n.instrument`, `mod.samples` with `module.instruments`, and `nameOf`'s lookup accordingly. Replace the hard-coded `mod.order.length * ROWS_PER_PATTERN` total-row count with `flattenRows(module).length`, so a pattern break shortens the score rather than leaving empty bars:

```ts
const totalRows = Math.max(1, flattenRows(module).length);
```

That was `ROWS_PER_PATTERN`'s only use (`import.ts:91`), so delete the constant at `import.ts:25` too — 64 rows is a ProTracker fact and no longer belongs in shared code. `ROWS_PER_BEAT` and `BEATS_PER_MEASURE` stay: they are the row-grid convention, not a format detail.

- [ ] **Step 5: Fill the gaps**

In the voice-building block, replace:

```ts
const voices: Voice[] = voiceEvents.map((events, i) => {
  const id = measure.voices[i]?.id ?? createId();
  return { id, name: `Voice ${i + 1}`, events: events.map((e) => ({ ...e, voiceId: id })) };
});
```

with:

```ts
const voices: Voice[] = voiceEvents.map((events, i) => {
  const id = measure.voices[i]?.id ?? createId();
  return {
    id,
    name: `Voice ${i + 1}`,
    // Rests around the notes, or the bar does not add up — see `fill.ts`.
    events: fillVoiceWithRests(
      events,
      measure.startTick,
      measure.durationTicks,
      base.ppq,
      track.id,
      id,
    ),
  };
});
```

and import `fillVoiceWithRests` from `./fill.js`.

- [ ] **Step 6: Move tempo reading onto the neutral fields**

In `src/adapters/mod/timing.ts`: delete `periodToMidi` and its constants (it moved to `music_io` in Task 2), and change `tempoChanges` to read the neutral fields rather than decoding effect `F`:

```ts
export function tempoChanges(rows: readonly TrackerCell[][]): TempoChange[] {
  let speed = DEFAULT_SPEED;
  let tempo = DEFAULT_TEMPO;
  const out: TempoChange[] = [{ row: 0, bpm: effectiveBpm(speed, tempo) }];

  rows.forEach((cells, row) => {
    let changed = false;
    for (const cell of cells) {
      if (cell.speed !== undefined) {
        speed = cell.speed;
        changed = true;
      }
      if (cell.bpm !== undefined) {
        tempo = cell.bpm;
        changed = true;
      }
    }
    if (changed && row > 0) out.push({ row, bpm: effectiveBpm(speed, tempo) });
  });

  return out;
}
```

Read the existing implementation first and keep its de-duplication behaviour — the current version emits an entry only where a knob actually moves, and this must not start emitting one per row.

Update `timing.test.ts`: drop the `periodToMidi` cases (now in `music_io`), and rewrite the `tempoChanges` cases to build `TrackerCell`s with `speed`/`bpm` instead of `effect`/`param`.

- [ ] **Step 7: Update the re-exports**

`src/adapters/mod/types.ts` becomes:

```ts
/** The shape `music_io`'s `TrackerCodec.decode` produces. */
export type { TrackerCell, TrackerFormat, TrackerInstrument, TrackerModule } from '@sudobility/music_types';
```

In `src/index.ts`, `modToScore` becomes `trackerToScore` and `periodToMidi` is no longer exported. `effectiveBpm` and `tempoChanges` stay.

- [ ] **Step 8: Run the suite**

Run: `bun run test && bun run typecheck`
Expected: PASS. Existing `import.test.ts` cases that build `ModFile` fixtures now fail to compile — rewrite them onto `moduleWith`, keeping what each asserts.

- [ ] **Step 9: Sabotage check**

In `fillVoiceWithRests`'s call site, pass `events` straight through instead (`events: events.map((e) => ({ ...e, voiceId: id }))`). Expected: "produces a score with no validation errors or underfull warnings" FAILS. Restore.

- [ ] **Step 10: Verify and propagate**

```bash
bun run verify
bun run clean && bun run build
rsync -a --delete dist/ ../music_app/node_modules/@sudobility/music_lib/dist/
rm -rf ../music_app/node_modules/.vite
```

---

### Task 5: The app, and proving it on the real file

**Repo:** `music_app`

**Files:**
- Modify: `src/features/projects/DashboardPage.tsx:348-349`
- Modify: `src/features/projects/DashboardPage.test.tsx` if it references `modToScore`

- [ ] **Step 1: Update the import handler**

In `handleImportModFile`, `modToScore` becomes `trackerToScore`:

```ts
const mod = getAppServices().io.modCodec.decode(bytes);
const score = trackerToScore(mod);
```

and the import at the top of the file changes to match. The service property stays `modCodec` — renaming it is app-surface work and belongs with the later plan that widens the accepted extensions.

- [ ] **Step 2: Typecheck and test**

Run: `bun run typecheck && bun run test`
Expected: PASS.

- [ ] **Step 3: Prove the fix on the file that exposed it**

This is the point of the whole plan, and no unit test substitutes for it. In `music_io`, temporarily:

```bash
cat > src/shared/mod/__check.test.ts <<'EOF'
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { trackerToScore, validateScore } from '@sudobility/music_lib';
import { readMod } from './read.js';

it('imports the real module with no underfull bars', () => {
  const buf = readFileSync('/Users/johnhuang/Downloads/ascender_-_overscan.mod');
  const module = readMod(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const score = trackerToScore(module);
  const issues = validateScore(score);
  // eslint-disable-next-line no-console
  console.log(`tracks=${score.tracks.length} issues=${issues.length}`);
  expect(issues.filter((i) => i.code === 'measure-underfull')).toEqual([]);
});
EOF
npx vitest run src/shared/mod/__check.test.ts --silent=false --disable-console-intercept
rm src/shared/mod/__check.test.ts
```

Expected: `issues=0`, where it was 554. If the file is not at that path, use any `.mod` — the eight downloaded during investigation are under the session scratchpad.

- [ ] **Step 4: Update the docs**

`music_app/CLAUDE.md`'s `.MOD` import gotcha: it says notes group "by sample", which is now "by instrument"; the finetune limitation now lives in `music_io`; and it should record that rests fill every gap because a bar that does not add up renders short.

`music_lib/CLAUDE.md`: `trackerToScore` and `fill.ts`.

`music_io/CLAUDE.md`: `periodToMidi` living beside the MOD reader, and why.

- [ ] **Step 5: Deploy**

```bash
cd /Users/johnhuang/projects/music_app && ./scripts/push_all.sh
```

Watch for the npm race the script's own comments describe: if a downstream repo fails typecheck on a symbol that exists in the source it was just built against, the published version has not propagated yet. Poll `npm view @sudobility/<pkg> version`, `bun update` that package, and resume with `--starting-project <name>`.

- [ ] **Step 6: Report back**

Say what the real file's issue count went from and to, which tests were rewritten and why, and anything the plan's code did not match. The next plan is the DSM decoder — the simplest of the four, and the one that proves the neutral model holds without changing it.

---

## Self-Review Notes

**Spec coverage:** §1 (the model) → Task 1. §2's MOD half → Task 2. §3 (score mapping) → Task 4. §4 (the underfull defect) → Tasks 3 and 4. §8 steps 1-2 → all five tasks. §6 app surface and §7 fixtures are **not** here: they belong with the plans that add formats, since there is nothing new to accept yet.

**Deliberately out of scope:** the S3M, XM, IT, DSM and MPTM decoders (§2's other half), the widened `accept` list, and the committed fixture corpus. Each new decoder is its own plan; this one exists to make them cheap.

**Type consistency, checked:** `TrackerCell.instrument` is used in Tasks 1, 2 and 4; `TrackerCell.note` is `number | 'off' | null` everywhere; `fillVoiceWithRests`'s six parameters match between its definition in Task 3 and its call in Task 4; `periodToMidi` is created in `music_io` in Task 2 and deleted from `music_lib` in Task 4 Step 6, with no window where both exist.

**Verified against the code, not assumed:** `decomposeDuration(ticks, ppq): number[]` exists and greedily splits a span into drawable values; a `RestEvent` is a `MusicalEvent` without a `pitch` property (`isNoteEvent` tests `'pitch' in event`); `createEmptyScore` already gives an untouched measure a full-measure rest, which is why measures with no notes were never the problem.
