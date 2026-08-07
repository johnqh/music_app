# .MOD Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** open an Amiga tracker module as an editable score.

**Architecture:** A platform-free parser in `music_io/src/shared/mod/`, exposed through a `ModCodec` capability on `MusicIo` that web, RN and mocks all delegate to. Parsing produces a `Score` directly: notes grouped by sample into tracks, overlapping notes allocated to voices, and speed/tempo changes emitted as a multi-event `TempoMap`.

**Tech Stack:** TypeScript (strict), Vitest, Playwright, Bun.

## Global Constraints

- **Import only.** No `.MOD` export — writing one requires embedding sample data.
- **One implementation, three delegates.** `ModCodec` is a capability for surface consistency, but nothing about parsing is platform-bound, so web/rn/mocks all call the same `shared/mod/` module. Same shape as `shared/audio/wav.ts`.
- **Notes are grouped by sample, not by channel.** Two channels playing one sample at the same tick produce simultaneous notes on one track — allocate **voices**, never assume a single line.
- **Both timing knobs are honoured.** `effectiveBpm = 6 × tempo ÷ speed`, emitted as a tempo event wherever either changes.
- **A row is a sixteenth note** (`ppq / 4` ticks). Row length in ticks is fixed; the _tempo_ moves.
- **The order list is flattened.** A pattern played three times becomes three sets of measures.
- **Do not commit or push.** `scripts/push_all.sh` does that.
- Publish order: `music_types` → `music_io` → `music_app`. Use `bun update`, not `bun add`, after publishing.

---

## The format, for reference

31-instrument ProTracker layout. All multi-byte values big-endian.

| offset | bytes   | meaning                                                                                           |
| ------ | ------- | ------------------------------------------------------------------------------------------------- |
| 0      | 20      | song title                                                                                        |
| 20     | 31 × 30 | sample headers: 22 name, 2 length (words), 1 finetune, 1 volume, 2 repeat offset, 2 repeat length |
| 950    | 1       | song length — how many order entries are used                                                     |
| 951    | 1       | restart byte (ignored)                                                                            |
| 952    | 128     | order list — pattern number per position                                                          |
| 1080   | 4       | magic: `M.K.`/`M!K!`/`4CHN` = 4 channels, `6CHN` = 6, `8CHN` = 8                                  |
| 1084   | …       | pattern data: 64 rows × channels × 4 bytes                                                        |

Each 4-byte cell:

```
sample = (b0 & 0xF0) | (b2 >> 4)
period = ((b0 & 0x0F) << 8) | b1     // 0 = no new note
effect = b2 & 0x0F
param  = b3
```

Effect `0xF` sets timing: `param ≤ 0x1F` sets **speed**, `param ≥ 0x20` sets **tempo**.

---

### Task 1: The capability

**Files:**

- Modify: `~/projects/music_types/src/platform/` (new `mod.ts`, exported from `index.ts`)
- Modify: `~/projects/music_io/src/shared/types.ts`, `src/web/index.ts`, `src/rn/index.ts`, `src/mocks/index.ts`
- Modify: `~/projects/music_io/src/contract/platform-contract.ts`

**Interfaces:**

```ts
export interface ModCodec {
  /** Parse a ProTracker module into a score. Throws on anything that is not one. */
  parse(bytes: ArrayBuffer): Score;
}
```

- [ ] **Step 1: Declare it**

Create `~/projects/music_types/src/platform/mod.ts`:

```ts
/**
 * Amiga tracker module parsing.
 *
 * A capability for surface consistency — the app reaches every file format
 * through `getAppServices().io` — even though nothing about parsing is
 * platform-bound. All three implementations delegate to one shared module.
 */
import type { Score } from '../index.js';

export interface ModCodec {
  /** Parse a ProTracker module into a score. Throws on anything that is not one. */
  parse(bytes: ArrayBuffer): Score;
}
```

Export it from `src/platform/index.ts`, and add `modCodec: ModCodec` to `MusicIo`
in `music_io/src/shared/types.ts`. Leave the three implementations unwired for
now: the compile error is the checklist.

- [ ] **Step 2: Add the contract test**

In `runPlatformContract`, beside the audio codec cases:

```ts
it('exposes a mod codec', () => {
  expect(createIo().modCodec).toBeDefined();
});

it('rejects bytes that are not a module', () => {
  // A garbage score is worse than a clear failure: it looks like the file
  // imported and quietly is not the music.
  expect(() => createIo().modCodec.parse(new ArrayBuffer(64))).toThrow();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd ~/projects/music_io && bun run test contract`
Expected: FAIL — `modCodec` is undefined on every platform.

---

### Task 2: Reading the file

**Files:**

- Create: `~/projects/music_io/src/shared/mod/read.ts`, `read.test.ts`

**Interfaces:**

```ts
export type ModSample = { index: number; name: string };
export type ModCell = { sample: number; period: number; effect: number; param: number };
export type ModFile = {
  title: string;
  channels: number;
  samples: ModSample[];
  /** Pattern index per playback position, already trimmed to the song length. */
  order: number[];
  /** `patterns[p][row][channel]`. */
  patterns: ModCell[][][];
};
export function readMod(bytes: ArrayBuffer): ModFile;
```

- [x] **Step 1: Write the failing test**

Create `read.test.ts` with a **builder**, because every later test needs one and
hand-writing byte offsets per test is how these suites rot:

```ts
import { describe, expect, it } from 'vitest';
import { readMod } from './read.js';

type CellSpec = { sample?: number; period?: number; effect?: number; param?: number };

/** Builds a minimal 4-channel ProTracker module. `rows[patternRow][channel]`. */
export function buildMod(opts: {
  title?: string;
  sampleNames?: string[];
  order?: number[];
  patterns?: CellSpec[][][];
}): ArrayBuffer {
  const patterns = opts.patterns ?? [[]];
  const bytes = new Uint8Array(1084 + patterns.length * 64 * 4 * 4);
  const write = (at: number, text: string, len: number) => {
    for (let i = 0; i < len; i += 1) bytes[at + i] = i < text.length ? text.charCodeAt(i) : 0;
  };

  write(0, opts.title ?? 'test', 20);
  (opts.sampleNames ?? []).forEach((name, i) => write(20 + i * 30, name, 22));

  const order = opts.order ?? [0];
  bytes[950] = order.length;
  order.forEach((p, i) => (bytes[952 + i] = p));
  write(1080, 'M.K.', 4);

  patterns.forEach((rows, p) => {
    const base = 1084 + p * 64 * 4 * 4;
    rows.forEach((channels, row) => {
      channels.forEach((cell, ch) => {
        const at = base + (row * 4 + ch) * 4;
        const sample = cell.sample ?? 0;
        const period = cell.period ?? 0;
        bytes[at] = (sample & 0xf0) | ((period >> 8) & 0x0f);
        bytes[at + 1] = period & 0xff;
        bytes[at + 2] = ((sample & 0x0f) << 4) | (cell.effect ?? 0);
        bytes[at + 3] = cell.param ?? 0;
      });
    });
  });

  return bytes.buffer;
}

describe('readMod', () => {
  it('reads the title and sample names', () => {
    const mod = readMod(buildMod({ title: 'Elysium', sampleNames: ['bass', 'lead'] }));
    expect(mod.title).toBe('Elysium');
    expect(mod.samples[0].name).toBe('bass');
    expect(mod.samples[1].name).toBe('lead');
  });

  it('reads four channels from an M.K. module', () => {
    expect(readMod(buildMod({})).channels).toBe(4);
  });

  it('trims the order list to the song length', () => {
    // The 128-byte order list is mostly junk past the song length; reading it
    // whole would play patterns the song never reaches.
    const mod = readMod(buildMod({ order: [0, 1, 0] }));
    expect(mod.order).toEqual([0, 1, 0]);
  });

  it('unpacks a cell into sample, period, effect and param', () => {
    const mod = readMod(
      buildMod({ patterns: [[[{ sample: 5, period: 428, effect: 0xf, param: 0x03 }]]] }),
    );
    const cell = mod.patterns[0][0][0];
    expect(cell).toEqual({ sample: 5, period: 428, effect: 0xf, param: 0x03 });
  });

  it('reads sample numbers above 15, which span both nibbles', () => {
    // The classic MOD parsing bug: the sample number is split across two bytes.
    const mod = readMod(buildMod({ patterns: [[[{ sample: 31, period: 428 }]]] }));
    expect(mod.patterns[0][0][0].sample).toBe(31);
  });

  it('reports an empty cell as period 0', () => {
    const mod = readMod(buildMod({ patterns: [[[{}]]] }));
    expect(mod.patterns[0][0][0].period).toBe(0);
  });

  it('rejects a file with no recognisable magic', () => {
    expect(() => readMod(new ArrayBuffer(2000))).toThrow(/not a .*module/i);
  });

  it('rejects a file too short to hold a header', () => {
    expect(() => readMod(new ArrayBuffer(64))).toThrow();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_io && bun run test shared/mod/read`

- [x] **Step 3: Implement the reader**

```ts
/**
 * Reading a ProTracker module into plain data.
 *
 * Deliberately stops at "what the file says" — no musical interpretation here,
 * so the byte handling can be tested against a hand-built buffer without any
 * score model in the way.
 */
export type ModSample = { index: number; name: string };
export type ModCell = { sample: number; period: number; effect: number; param: number };
export type ModFile = {
  title: string;
  channels: number;
  samples: ModSample[];
  order: number[];
  patterns: ModCell[][][];
};

const HEADER_BYTES = 1084;
const ROWS_PER_PATTERN = 64;

/** Channel count per magic. `M.K.`/`M!K!` are the ubiquitous 4-channel forms. */
const MAGIC_CHANNELS: Record<string, number> = {
  'M.K.': 4,
  'M!K!': 4,
  FLT4: 4,
  '4CHN': 4,
  '6CHN': 6,
  '8CHN': 8,
  CD81: 8,
  OKTA: 8,
};

function ascii(bytes: Uint8Array, at: number, len: number): string {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    const c = bytes[at + i];
    if (c === 0) break;
    // Sample names routinely carry decorative high-bit bytes; keep it printable.
    if (c >= 32 && c < 127) out += String.fromCharCode(c);
  }
  return out.trim();
}

export function readMod(buffer: ArrayBuffer): ModFile {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < HEADER_BYTES) throw new Error('Not a ProTracker module: file is too short');

  const magic = ascii(bytes, 1080, 4);
  const channels = MAGIC_CHANNELS[magic];
  if (!channels) throw new Error(`Not a ProTracker module: unrecognised signature "${magic}"`);

  const samples: ModSample[] = [];
  for (let i = 0; i < 31; i += 1) {
    samples.push({ index: i + 1, name: ascii(bytes, 20 + i * 30, 22) });
  }

  const songLength = Math.min(bytes[950], 128);
  const order: number[] = [];
  for (let i = 0; i < songLength; i += 1) order.push(bytes[952 + i]);

  // Patterns are not counted in the header; the highest order entry implies it.
  const patternCount = order.length === 0 ? 0 : Math.max(...order) + 1;
  const patterns: ModCell[][][] = [];
  for (let p = 0; p < patternCount; p += 1) {
    const rows: ModCell[][] = [];
    for (let row = 0; row < ROWS_PER_PATTERN; row += 1) {
      const cells: ModCell[] = [];
      for (let ch = 0; ch < channels; ch += 1) {
        const at = HEADER_BYTES + (p * ROWS_PER_PATTERN * channels + row * channels + ch) * 4;
        const b0 = bytes[at] ?? 0;
        const b1 = bytes[at + 1] ?? 0;
        const b2 = bytes[at + 2] ?? 0;
        const b3 = bytes[at + 3] ?? 0;
        cells.push({
          // The sample number spans both bytes' high nibbles — the classic
          // place this parser goes wrong for samples above 15.
          sample: (b0 & 0xf0) | (b2 >> 4),
          period: ((b0 & 0x0f) << 8) | b1,
          effect: b2 & 0x0f,
          param: b3,
        });
      }
      rows.push(cells);
    }
    patterns.push(rows);
  }

  return { title: ascii(bytes, 0, 20), channels, samples, order, patterns };
}
```

- [x] **Step 4: Run the tests to verify they pass**

- [x] **Step 5: Verify the tests are not vacuous**

Change the sample extraction to `b0 & 0xf0` alone and confirm the "above 15"
test fails. Drop the song-length trim and confirm the order test fails. Confirm
each edit landed (`grep -c`) before trusting the result.

---

### Task 3: Pitch and timing

**Files:**

- Create: `~/projects/music_io/src/shared/mod/timing.ts`, `timing.test.ts`

**Interfaces:**

```ts
export function periodToMidi(period: number): number | null;
export function effectiveBpm(speed: number, tempo: number): number;
export type TempoChange = { row: number; bpm: number };
export function tempoChanges(rows: readonly ModCell[][]): TempoChange[];
```

- [x] **Step 1: Write the failing test**

```ts
describe('periodToMidi', () => {
  it('maps the reference period to C2', () => {
    // Amiga period 856 is ProTracker's C-1, taken here as MIDI 36.
    expect(periodToMidi(856)).toBe(36);
  });

  it('maps an octave up to twelve semitones up', () => {
    // Halving the period raises the pitch an octave, by definition.
    expect(periodToMidi(428)).toBe(48);
    expect(periodToMidi(214)).toBe(60);
  });

  it('maps a semitone step', () => {
    expect(periodToMidi(808)).toBe(37);
  });

  it('reports no note for period 0', () => {
    expect(periodToMidi(0)).toBeNull();
  });
});

describe('effectiveBpm', () => {
  it('is 125 at the defaults', () => {
    expect(effectiveBpm(6, 125)).toBe(125);
  });

  it('doubles when speed halves', () => {
    // Fewer ticks per row means rows go by faster — the common case in fills.
    expect(effectiveBpm(3, 125)).toBe(250);
  });

  it('follows the tempo knob too', () => {
    expect(effectiveBpm(3, 100)).toBe(200);
  });
});

describe('tempoChanges', () => {
  const cell = (effect = 0, param = 0) => ({ sample: 0, period: 0, effect, param });

  it('starts at the defaults', () => {
    expect(tempoChanges([[cell()]])).toEqual([{ row: 0, bpm: 125 }]);
  });

  it('emits a change when speed is set', () => {
    // F03 = speed 3.
    const changes = tempoChanges([[cell()], [cell(0xf, 0x03)]]);
    expect(changes).toEqual([
      { row: 0, bpm: 125 },
      { row: 1, bpm: 250 },
    ]);
  });

  it('emits a change when tempo is set', () => {
    // F64 = tempo 100 (0x64 >= 0x20, so it is the BPM knob).
    const changes = tempoChanges([[cell()], [cell(0xf, 0x64)]]);
    expect(changes[1]).toEqual({ row: 1, bpm: 100 });
  });

  it('carries speed and tempo forward together', () => {
    const changes = tempoChanges([[cell()], [cell(0xf, 0x03)], [cell(0xf, 0x64)]]);
    expect(changes[2]).toEqual({ row: 2, bpm: 200 });
  });

  it('does not emit a change when the value is unchanged', () => {
    // A redundant tempo event per row would bloat the map for nothing.
    expect(tempoChanges([[cell()], [cell(0xf, 0x06)]])).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

- [x] **Step 3: Implement it**

```ts
/** ProTracker's C-1 period, taken as MIDI 36 (C2). */
const REFERENCE_PERIOD = 856;
const REFERENCE_MIDI = 36;

const DEFAULT_SPEED = 6;
const DEFAULT_TEMPO = 125;
/** Effect F: at or below this the parameter is speed; above it, tempo. */
const SPEED_LIMIT = 0x1f;

/** The pitch a period sounds, or null for "no new note". */
export function periodToMidi(period: number): number | null {
  if (period <= 0) return null;
  return Math.round(REFERENCE_MIDI + 12 * Math.log2(REFERENCE_PERIOD / period));
}

/**
 * Musical BPM from the two knobs.
 *
 * A row is a sixteenth (four to the beat) and a tick lasts 2.5/tempo seconds,
 * so a beat is `4 × speed × 2.5 / tempo` seconds — which reduces to
 * `6 × tempo / speed` beats per minute. At the defaults that is 125, as it
 * should be.
 */
export function effectiveBpm(speed: number, tempo: number): number {
  if (speed <= 0) return DEFAULT_TEMPO;
  return Math.round((6 * tempo) / speed);
}

export type TempoChange = { row: number; bpm: number };

/** One entry at row 0, then one wherever either knob actually moves. */
export function tempoChanges(rows: readonly ModCell[][]): TempoChange[] {
  let speed = DEFAULT_SPEED;
  let tempo = DEFAULT_TEMPO;
  const changes: TempoChange[] = [{ row: 0, bpm: effectiveBpm(speed, tempo) }];

  rows.forEach((cells, row) => {
    let moved = false;
    for (const cell of cells) {
      if (cell.effect !== 0xf || cell.param === 0) continue;
      if (cell.param <= SPEED_LIMIT) {
        if (speed !== cell.param) {
          speed = cell.param;
          moved = true;
        }
      } else if (tempo !== cell.param) {
        tempo = cell.param;
        moved = true;
      }
    }
    // Row 0's entry already exists; only emit again if something moved.
    if (moved && row > 0) changes.push({ row, bpm: effectiveBpm(speed, tempo) });
  });

  return changes;
}
```

- [x] **Step 4: Run the tests to verify they pass**

---

### Task 4: Building the score

**Files:**

- Create: `~/projects/music_io/src/shared/mod/to-score.ts`, `to-score.test.ts`
- Modify: the three `MusicIo` entries to supply `modCodec`

**Interfaces:**

```ts
export function modToScore(mod: ModFile): Score;
```

- [ ] **Step 1: Write the failing test**

```ts
describe('modToScore', () => {
  it('puts a note at the right pitch and tick', () => {
    const score = modToScore(readMod(buildMod({ patterns: [[[{ sample: 1, period: 428 }]]] })));
    const notes = allNotesOf(score);
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(48);
    expect(notes[0].startTick).toBe(0);
  });

  it('spaces rows a sixteenth apart', () => {
    const score = modToScore(
      readMod(
        buildMod({ patterns: [[[{ sample: 1, period: 428 }], [{ sample: 1, period: 428 }]]] }),
      ),
    );
    const ticks = allNotesOf(score)
      .map((n) => n.startTick)
      .sort((a, b) => a - b);
    expect(ticks[1] - ticks[0]).toBe(score.ppq / 4);
  });

  it('groups notes by sample, not by channel', () => {
    // The central mapping decision.
    const score = modToScore(
      readMod(
        buildMod({
          patterns: [
            [
              [
                { sample: 1, period: 428 },
                { sample: 2, period: 214 },
                { sample: 1, period: 856 },
              ],
            ],
          ],
        }),
      ),
    );
    expect(score.tracks).toHaveLength(2);
    expect(allNotesOf(score).filter((n) => n.trackId === score.tracks[0].id)).toHaveLength(2);
  });

  it('puts simultaneous notes from two channels into different voices', () => {
    // A sample-grouped track is not always a single line.
    const score = modToScore(
      readMod(
        buildMod({
          patterns: [
            [
              [
                { sample: 1, period: 428 },
                { sample: 1, period: 214 },
              ],
            ],
          ],
        }),
      ),
    );
    expect(score.tracks).toHaveLength(1);
    const measure = score.tracks[0].measures[0];
    const withNotes = measure.voices.filter((v) => v.events.some((e) => 'pitch' in e));
    expect(withNotes.length).toBeGreaterThanOrEqual(2);
  });

  it('flattens a repeated pattern in the order list', () => {
    const once = modToScore(
      readMod(buildMod({ order: [0], patterns: [[[{ sample: 1, period: 428 }]]] })),
    );
    const thrice = modToScore(
      readMod(buildMod({ order: [0, 0, 0], patterns: [[[{ sample: 1, period: 428 }]]] })),
    );
    expect(allNotesOf(thrice)).toHaveLength(allNotesOf(once).length * 3);
  });

  it('carries speed and tempo changes into the tempo map', () => {
    const score = modToScore(
      readMod(
        buildMod({ patterns: [[[{ sample: 1, period: 428 }], [{ effect: 0xf, param: 0x03 }]]] }),
      ),
    );
    expect(score.tempoMap.length).toBeGreaterThan(1);
    expect(score.tempoMap[1].bpm).toBe(250);
  });

  it('names a track from its sample, falling back when it is blank', () => {
    const named = modToScore(
      readMod(buildMod({ sampleNames: ['bassline'], patterns: [[[{ sample: 1, period: 428 }]]] })),
    );
    expect(named.tracks[0].name).toBe('bassline');

    const blank = modToScore(readMod(buildMod({ patterns: [[[{ sample: 7, period: 428 }]]] })));
    expect(blank.tracks[0].name).toBe('Sample 7');
  });

  it('ignores cells with no note', () => {
    expect(allNotesOf(modToScore(readMod(buildMod({ patterns: [[[{}]]] }))))).toHaveLength(0);
  });
});
```

with a local `allNotesOf(score)` returning `{ midi, startTick, trackId }` for
every note, built by walking tracks → measures → voices → events.

- [ ] **Step 2: Run it to verify it fails**

- [ ] **Step 3: Implement it**

Build the score from `createEmptyScore` with one track per sample that is
actually used, enough 4/4 measures to hold `order.length × 64` rows at
`ppq / 4` ticks per row, and:

- a note per cell with a non-zero period, at
  `(orderIndex × 64 + row) × ppq / 4`, lasting one row unless the same
  channel plays again sooner — in which case it ends there, because a channel
  is monophonic;
- **voice allocation per track**: within a measure, a note whose tick overlaps
  one already placed goes into the next voice;
- `tempoChanges` mapped from row numbers to ticks, becoming `score.tempoMap`;
- track names from `sample.name`, falling back to `Sample N`.

- [ ] **Step 4: Wire the capability**

Create `shared/mod/index.ts` exporting
`createModCodec(): ModCodec` as `{ parse: (bytes) => modToScore(readMod(bytes)) }`,
and have all three `MusicIo` entries use it — one implementation, three
delegates.

- [ ] **Step 5: Run everything**

Run: `cd ~/projects/music_io && bun run verify`
Expected: PASS, including the Task 1 contract tests.

- [ ] **Step 6: Verify the tests are not vacuous**

Group by channel instead of sample and confirm the grouping test fails. Put
every note in voice 0 and confirm the simultaneous-notes test fails. Restore,
confirming each edit landed.

---

### Task 5: The app, and end to end

**Files:**

- Modify: `~/projects/music_app/src/components/layout/AppLayout.tsx`
- Create: `~/projects/music_app/e2e/mod-import.spec.ts`

- [ ] **Step 1: Add the menu entry**

An **Import → Module (.MOD)…** item beside the others, using the same
file-input-in-the-menu pattern as `Project JSON…` — read the file, call
`getAppServices().io.modCodec.parse(bytes)`, and `setScore` the result. Report
failures through `reportError` as the other imports do, so a non-MOD file gives
a toast rather than a blank score.

- [ ] **Step 2: Write the e2e**

Build a small module in Node with the same `buildMod` helper (copy it into
`e2e/`, or export it from `music_io` for reuse), import it, and assert tracks
and notes appear. Wait for any dialog to be **hidden** before touching the
canvas — the overlay intercepts clicks.

- [ ] **Step 3: Run everything**

```bash
cd ~/projects/music_types && bun run verify
cd ~/projects/music_io && bun run verify
cd ~/projects/music_app && bun run verify && bun run test:e2e
```

- [ ] **Step 4: Try it by hand**

Import a real `.MOD` from the wild. Check by eye: tracks named after their
samples, notes in plausible octaves, and playback that broadly follows the
original's tempo including any speed changes. Real modules are the only test of
whether the period table and the timing formula agree with reality.

---

## Self-Review

**Spec coverage.** `ModCodec` capability with one shared implementation → Tasks 1 and 4. Grouped by sample → Task 4, asserted. Simultaneous notes into voices → Task 4, asserted. Both timing knobs, real `TempoMap` → Tasks 3 and 4. Row = sixteenth → Task 3's formula and Task 4's spacing test. Order list flattened → Task 4, asserted. Sample-name fallback → Task 4. Rejecting a non-module → Tasks 1 and 2. e2e → Task 5.

**Deliberate gaps, stated rather than hidden:**

- **`periodToMidi` computes from a reference period rather than looking up ProTracker's table.** The table is not perfectly equal-tempered — finetune values shift it — so a real module may land a note or two differently than a tracker would show. The hand check in Task 5 Step 4 is what would catch that; a lookup table is the fix if it matters.
- **Finetune is ignored entirely.** It shifts pitch by fractions of a semitone, which the score model cannot represent anyway.
- **Note durations are "until the channel plays again"**, so the last note of a channel lasts one row. Tracker notes have no length; anything else would be invention.
- **`tempoChanges` reads rows in playback order** and so must be given the _flattened_ sequence, not one pattern. Task 4 has to flatten before calling it — passing a single pattern would silently miss changes in later ones.

**Type consistency.** `ModFile`/`ModCell` are produced by `readMod` in Task 2 and consumed by `tempoChanges` (Task 3) and `modToScore` (Task 4). `ModCodec` is declared in Task 1 and implemented in Task 4 Step 4. `TempoChange` carries a **row**, which Task 4 converts to ticks — the one place the units change.

---

## Execution Notes (2026-08-07) — PARTIAL: parsing and timing complete

**Complete: Tasks 2 and 3** — the two pure modules, which are the whole of the
byte handling and all of the arithmetic. `music_io` 141 tests green.

- `read.ts` — header, sample names, order list trimmed to the song length, and
  pattern cells unpacked. 8 tests, driven by a `buildMod` builder so later
  tasks do not hand-write byte offsets.
- `timing.ts` — `periodToMidi`, `effectiveBpm`, `tempoChanges`. 12 tests.

**The derived formula holds.** `effectiveBpm = 6 × tempo ÷ speed` produces
125 / 250 / 200 for the three cases the spec predicted, so the derivation
(a row is a sixteenth, a tick is 2.5/tempo seconds) is sound rather than
plausible.

Sabotage-verified, each edit confirmed to have landed first:

- dropping the `(b0 & 0xf0) | (b2 >> 4)` nibble merge fails two tests,
  including the one for samples above 15 — the classic silent MOD parsing bug;
- dropping the song-length trim fails the order test;
- ignoring speed in the BPM fails four tests; ignoring the speed _effect_ fails
  three more.

### A correction to Tasks 1 and 4, found before building them

The plan has `ModCodec.parse(bytes): Score`. That is the wrong shape, and it
undercuts the reason the capability was chosen in the first place.

`MidiCodec` is `decode(data): MidiFile` — **raw data out**, with `music_lib`'s
`adapters/midi/import.ts` doing the mapping to a `Score`. Every other format
follows that split. A `ModCodec` that returns a fully-built `Score` would be
the one format shaped differently, which is precisely what choosing a
capability for consistency was meant to avoid.

**The corrected shape:**

- `music_types` declares `ModFile`/`ModCell`/`ModSample` beside `MidiFile`, and
  `ModCodec { decode(bytes: ArrayBuffer): ModFile }`.
- `music_io/src/shared/mod/read.ts` — already written and tested — _is_ the
  implementation of `decode`. No change needed to it.
- **`modToScore` moves to `music_lib`**, as `adapters/mod/import.ts`, beside
  the MIDI importer. That is also where it belongs on its own merits: sample
  grouping, voice allocation and building a `TempoMap` are score-model work,
  and putting them in `music_lib` makes them testable without the platform
  layer.
- `timing.ts` should move with it for the same reason — `periodToMidi` and
  `effectiveBpm` are musical conversions, not byte handling. Its 12 tests move
  unchanged.

This does not invalidate the work done: `read.ts` stays exactly as it is, and
`timing.ts` changes only its address.

### Task 4 complete, in the corrected layer

`music_lib/src/adapters/mod/` now holds `types.ts`, `timing.ts` (moved from
music_io, its 12 tests unchanged) and `import.ts` with `modToScore`. 9 new
tests; **1098 green** in music_lib.

Sabotage-verified, each edit confirmed to have landed: grouping by channel
instead of sample fails three tests; forcing every note into voice 0 fails the
simultaneous-notes test.

`ModFile` is declared structurally in `adapters/mod/types.ts` so this half did
not wait on a publish; it becomes a re-export once the type lands in
music_types beside `MidiFile`.

**Remaining: Task 1** — `ModFile`/`ModCodec` in `music_types`, `readMod` wired
as `decode` on all three `MusicIo` entries, one publish — and **Task 5**, the
app menu entry (`io.modCodec.decode` → `modToScore` → `setScore`) and the e2e.

Not committed — `scripts/push_all.sh` owns commits.
