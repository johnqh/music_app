# XM Decoder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import FastTracker 2 `.xm` modules — the first format with self-sized headers, variable rows per pattern, and an explicit key-off in every real file.

**Architecture:** A forward walk in which almost nothing has a fixed size: the file header, each pattern header and each *instrument* header all declare their own length, and the reader must seek by those declarations rather than by constants. Patterns come before instruments, so instruments can only be found by walking every pattern first. Effects reuse `applyProTrackerEffect` — verified, XM splits `F` at `0x20` exactly as MOD does. No change to `TrackerModule` or `trackerToScore`.

**Tech Stack:** TypeScript (strict, ESM, extensionless relative imports built by `tsc`), Vitest.

## Global Constraints

- **Repos:** `music_io` for everything except the final app copy change and docs. `music_types` and `music_lib` are **not** expected to change; if either does, stop and say so, because that would mean the neutral model has a gap.
- **Relative imports carry a `.js` extension** even from `.ts` files. House style; do not "fix" it.
- **Cross-repo propagation:** after changing `music_io` run `bun run clean && bun run build`, `rsync -a --delete dist/ ../<consumer>/node_modules/@sudobility/music_io/dist/` for both `music_lib` and `music_app`, then `rm -rf ../music_app/node_modules/.vite`.
- **Sample payloads are skipped, never decoded.** XM stores sample lengths in per-sample headers; the reader sums them to find the next instrument and never reads the audio.
- **Verify by sabotage.** After each task's tests pass, break the implementation line the test targets, confirm that test fails, restore.
- **Spec:** `docs/superpowers/specs/2026-08-17-tracker-formats-design.md`.
- **Do not commit manually.** When the plan says deploy, run `music_app/scripts/push_all.sh`.

## Format facts, verified against four real files

Measured against `sunlight.xm` (142447), `wily.xm` (58823), `mercury.xm` (153249) and `1funk.xm` (3). **All four walked to exactly end-of-file** — byte-for-byte, no slack — which is the strongest confirmation available that the size arithmetic below is right.

**File header.** `Extended Module: ` (17 bytes) at 0; module name (20) at 17; `0x1A` at 37; tracker name (20) at 38; version uint16 at 58; **header size uint32 at 60, counted from offset 60**. Then:

| Offset | Field | sunlight | wily | mercury |
| --- | --- | --- | --- | --- |
| 64 | songLength | 20 | 26 | 92 |
| 66 | restartPosition | — | — | — |
| 68 | numChannels | 18 | 8 | 18 |
| 70 | numPatterns | 16 | 26 | 92 |
| 72 | numInstruments | 15 | 16 | 64 |
| 74 | flags | — | — | — |
| 76 | defaultSpeed | 6 | 3 | 6 |
| 78 | defaultBPM | 125 | 150 | 125 |
| 80 | order table, `songLength` bytes | max 15 | max 25 | max 91 |

Header size was 276 in all four, putting the first pattern at `60 + 276 = 336`. The order maximum equalled `numPatterns - 1` in every file.

**Pattern header:** uint32 headerLength at 0 (observed 9 everywhere, but **read it, do not assume it** — it is the documented mechanism); uint8 packingType at 4 (always 0); uint16 **numRows** at 5; uint16 packedSize at 7. Data begins at `patternStart + headerLength` and the next pattern begins at `patternStart + headerLength + packedSize`.

**Packed events**, read left to right, filling channel 0…numChannels-1 then advancing a row:

- Read a byte. **If bit 7 is set** it is a field mask: bit 0 note, bit 1 instrument, bit 2 volume, bit 3 effect, bit 4 parameter — each present field follows in that order.
- **If bit 7 is clear**, the byte *is* the note, and instrument, volume, effect and parameter all follow uncompressed (four more bytes).

**Note values:** 0 none, 1–96 notes with 1 = C-0, **97 = key off**. MIDI is `note + 11`. Observed 13–93 across the four files.

**Effects are ProTracker's.** Effect `F` (15) carried parameters 1–24 and 125 across the corpus — below `0x20` a speed, above it a BPM, exactly MOD's split. Effect `D` (13) appeared as a pattern break. So `applyProTrackerEffect` is reused rather than rewritten.

### Finding 1: instrument header size varies *within* a file

This is the trap the spec predicted, and it is real:

| File | `(instrumentHeaderSize, numSamples)` |
| --- | --- |
| sunlight.xm | `(263, 1) × 7`, **`(33, 0) × 8`** |
| mercury.xm | `(263, 1) × 22`, **`(33, 0) × 42`** |
| wily.xm | `(263, 1) × 16` |

An instrument with no samples writes a 33-byte header; one with samples writes 263. **Assuming 263 desynchronises everything after the first empty instrument** — and `sunlight.xm` has eight of them among fifteen. The reader must read the size from each instrument and seek by it.

Finding the *next* instrument then needs three quantities: the header size, the sample-header size (uint32 at instrument+29, present only when `numSamples > 0`), and the sum of every sample's length (uint32 at each sample header's own offset 0):

```
next = start + instrumentHeaderSize + numSamples * sampleHeaderSize + Σ sampleLengths
```

That arithmetic is what produced exact end-of-file on all four files.

### Finding 2: patterns have different row counts

`wily.xm` holds a 76-row pattern among its 64s; `mercury.xm` holds 32- and 56-row patterns. XM is the first format here to actually exercise `TrackerModule`'s per-pattern row count — MOD, DSM and S3M are all fixed at 64 — so this is the model's first real test on that axis, and it needs no change.

### Finding 3: empty patterns declare rows but carry no data

`wily.xm` has 4 patterns and `mercury.xm` 18 with `packedSize = 0`. They are not zero-length: they declare `numRows` and mean that many **blank** rows. Emitting nothing would shorten the song and shift everything after them.

### Finding 4: key-off is finally confirmed

Note value 97 appears in **all four** files. DSM and S3M gave no note-off in any real module, so their handling is spec-derived and fixture-tested only. XM's is confirmed against reality, and it is the first format here where `TrackerCell.note === 'off'` is known to be exercised by genuine music.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/shared/tracker/xm.ts` | the XM reader | **Create** |
| `src/shared/tracker/xm.test.ts` | | **Create** |
| `src/shared/tracker/xm-fixture.ts` | hand-built XM buffer | **Create** |
| `src/shared/mod/codec.ts` | `SharedTrackerCodec` | Modify: detect `Extended Module: ` |
| `src/shared/mod/codec.test.ts` | | Modify: an XM case |
| `src/shared/tracker/fixtures/` | real modules | Add `sunlight.xm`, `wily.xm` |
| `music_app/src/features/projects/DashboardPage.tsx` | file input + copy | Modify: add `.xm` |

**Fixture choice matters here.** `sunlight.xm` (43 KB) is the file with the mixed 33/263 instrument headers; `wily.xm` (48 KB) is the one with the 76-row pattern and four empty patterns. Between them they exercise every finding above. `mercury.xm` (1.1 MB) and `1funk.xm` (777 KB) are too large to commit and add nothing the other two do not cover.

---

### Task 1: The fixture builder

**Files:**
- Create: `src/shared/tracker/xm-fixture.ts`

**Interfaces:**
- Produces: `export function buildXm(opts?: XmOptions): ArrayBuffer;`

Exercised by every test in Tasks 2–4. It is its own task because it must be able to produce the awkward cases deliberately — an instrument with no samples, a pattern with no data, a pattern that is not 64 rows — and reviewing that against the findings above is a different activity from reviewing a parser.

- [ ] **Step 1: Write it**

```ts
/**
 * A hand-built XM file, for testing the reader against known bytes.
 *
 * Deliberately able to produce the three awkward shapes real files contain: an
 * instrument with no samples (a 33-byte header rather than 263), a pattern with
 * no packed data (blank rows, not zero rows), and a pattern that is not 64 rows
 * long. A builder that could only make the easy case would agree with a reader
 * that could only read it.
 */

export type XmCellSpec = {
  /** 1-96, where 1 is C-0. 97 is key off. Omitted for an empty cell. */
  note?: number;
  instrument?: number;
  volume?: number;
  effect?: number;
  param?: number;
  /** Write this event uncompressed — the bit-7-clear form. */
  uncompressed?: boolean;
};

export type XmPatternSpec = {
  rows: number;
  /** `cells[row][channel]`; missing entries are empty. */
  cells?: XmCellSpec[][];
  /** Emit `packedSize = 0`, meaning `rows` blank rows. */
  empty?: boolean;
};

export type XmOptions = {
  title?: string;
  channels?: number;
  order?: number[];
  patterns?: XmPatternSpec[];
  /** One entry per instrument; `samples: 0` writes the 33-byte header form. */
  instruments?: Array<{ name: string; samples?: number; sampleLengths?: number[] }>;
  defaultSpeed?: number;
  defaultBPM?: number;
};

const HEADER_SIZE = 276;
const INSTRUMENT_HEADER_WITH_SAMPLES = 263;
const INSTRUMENT_HEADER_EMPTY = 33;
const SAMPLE_HEADER_SIZE = 40;

function ascii(out: Uint8Array, at: number, text: string, length: number): void {
  for (let i = 0; i < length; i += 1) out[at + i] = i < text.length ? text.charCodeAt(i) : 0;
}

function packPattern(spec: XmPatternSpec, channels: number): Uint8Array {
  if (spec.empty) return new Uint8Array(0);
  const body: number[] = [];
  for (let row = 0; row < spec.rows; row += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      const cell = spec.cells?.[row]?.[ch];
      if (!cell) {
        // An empty cell is a mask byte with no fields selected.
        body.push(0x80);
        continue;
      }
      if (cell.uncompressed) {
        body.push(
          cell.note ?? 0,
          cell.instrument ?? 0,
          cell.volume ?? 0,
          cell.effect ?? 0,
          cell.param ?? 0,
        );
        continue;
      }
      let mask = 0x80;
      if (cell.note !== undefined) mask |= 1;
      if (cell.instrument !== undefined) mask |= 2;
      if (cell.volume !== undefined) mask |= 4;
      if (cell.effect !== undefined) mask |= 8;
      if (cell.param !== undefined) mask |= 16;
      body.push(mask);
      if (cell.note !== undefined) body.push(cell.note);
      if (cell.instrument !== undefined) body.push(cell.instrument);
      if (cell.volume !== undefined) body.push(cell.volume);
      if (cell.effect !== undefined) body.push(cell.effect);
      if (cell.param !== undefined) body.push(cell.param);
    }
  }
  return new Uint8Array(body);
}

export function buildXm(opts: XmOptions = {}): ArrayBuffer {
  const channels = opts.channels ?? 4;
  const order = opts.order ?? [0];
  const patterns = opts.patterns ?? [{ rows: 64 }];
  const instruments = opts.instruments ?? [{ name: 'Lead', samples: 1, sampleLengths: [64] }];

  const packedPatterns = patterns.map((p) => packPattern(p, channels));

  const patternBlocks = patterns.map((spec, i) => {
    const head = new Uint8Array(9);
    const view = new DataView(head.buffer);
    view.setUint32(0, 9, true);
    head[4] = 0;
    view.setUint16(5, spec.rows, true);
    view.setUint16(7, packedPatterns[i].length, true);
    return { head, data: packedPatterns[i] };
  });

  const instrumentBlocks = instruments.map((ins) => {
    const samples = ins.samples ?? 0;
    const lengths = ins.sampleLengths ?? Array.from({ length: samples }, () => 64);
    const headerSize = samples > 0 ? INSTRUMENT_HEADER_WITH_SAMPLES : INSTRUMENT_HEADER_EMPTY;
    const total =
      headerSize + samples * SAMPLE_HEADER_SIZE + lengths.reduce((n, l) => n + l, 0);
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, headerSize, true);
    ascii(out, 4, ins.name, 22);
    out[26] = 0;
    view.setUint16(27, samples, true);
    if (samples > 0) {
      view.setUint32(29, SAMPLE_HEADER_SIZE, true);
      lengths.forEach((length, s) => {
        view.setUint32(headerSize + s * SAMPLE_HEADER_SIZE, length, true);
      });
    }
    return out;
  });

  const bodySize =
    patternBlocks.reduce((n, p) => n + p.head.length + p.data.length, 0) +
    instrumentBlocks.reduce((n, i) => n + i.length, 0);
  const out = new Uint8Array(60 + HEADER_SIZE + bodySize);
  const view = new DataView(out.buffer);

  ascii(out, 0, 'Extended Module: ', 17);
  ascii(out, 17, opts.title ?? 'Fixture', 20);
  out[37] = 0x1a;
  ascii(out, 38, 'FastTracker v2.00   ', 20);
  view.setUint16(58, 0x0104, true);
  view.setUint32(60, HEADER_SIZE, true);
  view.setUint16(64, order.length, true);
  view.setUint16(68, channels, true);
  view.setUint16(70, patterns.length, true);
  view.setUint16(72, instruments.length, true);
  view.setUint16(76, opts.defaultSpeed ?? 6, true);
  view.setUint16(78, opts.defaultBPM ?? 125, true);
  order.forEach((value, i) => {
    out[80 + i] = value;
  });

  let at = 60 + HEADER_SIZE;
  for (const { head, data } of patternBlocks) {
    out.set(head, at);
    at += head.length;
    out.set(data, at);
    at += data.length;
  }
  for (const block of instrumentBlocks) {
    out.set(block, at);
    at += block.length;
  }
  return out.buffer;
}
```

- [ ] **Step 2: Confirm it typechecks**

Run: `bun run typecheck`
Expected: PASS. Task 2 is its first exercise.

---

### Task 2: Header and order list

**Files:**
- Create: `src/shared/tracker/xm.ts`, `src/shared/tracker/xm.test.ts`

**Interfaces:**
- Produces: `export function readXm(buffer: ArrayBuffer): TrackerModule;`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { readXm } from './xm.js';
import { buildXm } from './xm-fixture.js';

describe('readXm: header', () => {
  it('reads the title, channel count and format', () => {
    const xm = readXm(buildXm({ title: 'sunlight', channels: 8 }));
    expect(xm.title).toBe('sunlight');
    expect(xm.channels).toBe(8);
    expect(xm.format).toBe('xm');
  });

  it('reads the order list, trimmed to the song length', () => {
    const xm = readXm(
      buildXm({ order: [0, 2, 1], patterns: [{ rows: 64 }, { rows: 64 }, { rows: 64 }] }),
    );
    expect(xm.order).toEqual([0, 2, 1]);
  });

  it('rejects a file without the XM signature', () => {
    const bytes = new Uint8Array(buildXm({}));
    bytes[0] = 0;
    expect(() => readXm(bytes.buffer)).toThrow(/not a .*module/i);
  });

  it('rejects a file too short to hold a header', () => {
    expect(() => readXm(new ArrayBuffer(32))).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- src/shared/tracker/xm.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the header half**

```ts
/**
 * Reading a FastTracker 2 module into the neutral tracker model.
 *
 * Almost nothing in an XM has a fixed size. The file header, every pattern
 * header and — the one that catches people — every *instrument* header declares
 * its own length, and the reader must seek by those declarations. An instrument
 * with no samples writes a 33-byte header where one with samples writes 263, so
 * assuming the larger desynchronises everything after the first empty slot.
 * `sunlight.xm` has eight empty instruments among fifteen.
 *
 * Patterns come before instruments in the file, so the instruments can only be
 * found by walking every pattern first.
 *
 * **Measured against four real modules** (modarchive 142447, 58823, 153249 and
 * 3), all of which walk to exactly end-of-file under the arithmetic here.
 *
 * Sample data is never read — only its length, to find the next instrument.
 */
import type { TrackerCell, TrackerInstrument, TrackerModule } from '@sudobility/music_types';
import { applyProTrackerEffect } from './protracker-effects.js';

const SIGNATURE = 'Extended Module: ';
const HEADER_SIZE_AT = 60;
const ORDER_AT = 80;
const INSTRUMENT_NAME_AT = 4;
const INSTRUMENT_NAME_LENGTH = 22;
const NUM_SAMPLES_AT = 27;
const SAMPLE_HEADER_SIZE_AT = 29;

/** Note 1 is C-0, so MIDI is the value plus eleven. 97 is a key off. */
const NOTE_BASE = 11;
const KEY_OFF = 97;

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const c = bytes[at + i];
    if (c === 0) break;
    if (c >= 32 && c < 127) out += String.fromCharCode(c);
  }
  return out.trim();
}

export function readXm(buffer: ArrayBuffer): TrackerModule {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < ORDER_AT) {
    throw new Error('Not a FastTracker module: file is too short');
  }
  if (ascii(bytes, 0, SIGNATURE.length) !== SIGNATURE.trim()) {
    throw new Error('Not a FastTracker module: missing the "Extended Module: " signature');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Counted *from* offset 60, not from the start of the file.
  const headerSize = view.getUint32(HEADER_SIZE_AT, true);
  const songLength = view.getUint16(64, true);
  const channels = view.getUint16(68, true);

  const order: number[] = [];
  for (let i = 0; i < songLength; i += 1) order.push(bytes[ORDER_AT + i]);

  // Patterns and instruments arrive in Tasks 3 and 4; `headerSize` is read
  // here because it is what locates them, and is deliberately left unused
  // until then rather than read twice.
  void headerSize;
  const patterns: TrackerCell[][][] = [];
  const instruments: TrackerInstrument[] = [];

  return {
    format: 'xm',
    title: ascii(bytes, 17, 20),
    channels,
    instruments,
    order,
    patterns,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/shared/tracker/xm.test.ts`
Expected: PASS.

- [ ] **Step 5: Note what is not yet covered**

There is no sabotage check here, and that is worth saying rather than faking one: nothing this task reads is load-bearing yet. `headerSize` locates the patterns but is not followed until Task 3, so breaking it fails nothing. Task 3 Step 6 and Task 4 Step 5 are where the real checks are.

---

### Task 3: Pattern unpacking

**Files:**
- Modify: `src/shared/tracker/xm.ts`, `src/shared/tracker/xm.test.ts`

**Interfaces:**
- Consumes: `applyProTrackerEffect`.
- Produces: no new exports; `readXm` returns populated patterns.

- [ ] **Step 1: Write the failing tests**

```ts
describe('readXm: pattern unpacking', () => {
  it('unpacks a masked event, reading only the fields the mask selects', () => {
    const xm = readXm(
      buildXm({
        channels: 2,
        patterns: [{ rows: 1, cells: [[{ note: 49, instrument: 3 }]] }],
      }),
    );
    // Note 1 is C-0, so MIDI is note + 11.
    expect(xm.patterns[0][0][0]).toMatchObject({ note: 60, instrument: 3 });
    expect(xm.patterns[0][0][1]).toEqual({ instrument: 0, note: null });
  });

  it('unpacks an uncompressed event, where the byte itself is the note', () => {
    // Bit 7 clear means all five fields follow. Treating it as a mask reads
    // the note as a field selector and desynchronises the rest of the row.
    const xm = readXm(
      buildXm({
        channels: 1,
        patterns: [
          { rows: 1, cells: [[{ note: 49, instrument: 5, effect: 0xf, param: 6, uncompressed: true }]] },
        ],
      }),
    );
    expect(xm.patterns[0][0][0]).toMatchObject({ note: 60, instrument: 5, speed: 6 });
  });

  it('treats note 97 as a key off', () => {
    // Confirmed present in all four real modules, unlike DSM's and S3M's.
    const xm = readXm(buildXm({ channels: 1, patterns: [{ rows: 1, cells: [[{ note: 97 }]] }] }));
    expect(xm.patterns[0][0][0].note).toBe('off');
  });

  it('treats note 0 as an empty cell', () => {
    const xm = readXm(buildXm({ channels: 1, patterns: [{ rows: 1, cells: [[{ note: 0 }]] }] }));
    expect(xm.patterns[0][0][0].note).toBeNull();
  });

  it('normalises effect F into speed and bpm as ProTracker does', () => {
    const xm = readXm(
      buildXm({
        channels: 1,
        patterns: [
          { rows: 2, cells: [[{ effect: 0xf, param: 6 }], [{ effect: 0xf, param: 125 }]] },
        ],
      }),
    );
    expect(xm.patterns[0][0][0].speed).toBe(6);
    expect(xm.patterns[0][1][0].bpm).toBe(125);
  });

  it('honours each pattern its own row count', () => {
    // wily.xm holds a 76-row pattern among its 64s; mercury.xm holds 32s and
    // 56s. XM is the first format here that is not fixed at 64.
    const xm = readXm(buildXm({ patterns: [{ rows: 32 }, { rows: 76 }] }));
    expect(xm.patterns[0]).toHaveLength(32);
    expect(xm.patterns[1]).toHaveLength(76);
  });

  it('gives an empty pattern its declared rows, blank', () => {
    // packedSize 0 means "this many blank rows", not "no rows". Emitting
    // nothing would shorten the song and shift everything after it.
    const xm = readXm(buildXm({ channels: 3, patterns: [{ rows: 64, empty: true }] }));
    expect(xm.patterns[0]).toHaveLength(64);
    expect(xm.patterns[0][0]).toHaveLength(3);
    expect(xm.patterns[0].every((row) => row.every((c) => c.note === null))).toBe(true);
  });

  it('finds the second pattern, which means it seeked by the first header length', () => {
    const xm = readXm(
      buildXm({
        channels: 1,
        patterns: [
          { rows: 1, cells: [[{ note: 49 }]] },
          { rows: 1, cells: [[{ note: 61 }]] },
        ],
      }),
    );
    expect(xm.patterns[0][0][0].note).toBe(60);
    expect(xm.patterns[1][0][0].note).toBe(72);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- src/shared/tracker/xm.test.ts`
Expected: FAIL — patterns are empty.

- [ ] **Step 3: Implement**

Add to `src/shared/tracker/xm.ts`:

```ts
const emptyCell = (): TrackerCell => ({ instrument: 0, note: null });

/**
 * One pattern, and where the next one starts.
 *
 * Two encodings share the stream. A byte with bit 7 set is a *mask*, selecting
 * which of note, instrument, volume, effect and parameter follow. A byte with
 * bit 7 clear **is the note**, and all five fields follow uncompressed. Reading
 * the second form as a mask desynchronises the rest of the pattern.
 *
 * `packedSize` of 0 means the pattern is blank — `rows` empty rows, not zero
 * rows. Real files use it: `wily.xm` has four and `mercury.xm` eighteen.
 */
function readPattern(
  bytes: Uint8Array,
  view: DataView,
  at: number,
  channels: number,
): { rows: TrackerCell[][]; next: number } {
  const headerLength = view.getUint32(at, true);
  const numRows = view.getUint16(at + 5, true);
  const packedSize = view.getUint16(at + 7, true);
  const start = at + headerLength;
  const end = Math.min(start + packedSize, bytes.length);

  const rows: TrackerCell[][] = Array.from({ length: numRows }, () =>
    Array.from({ length: channels }, emptyCell),
  );

  let pos = start;
  let row = 0;
  let channel = 0;
  while (pos < end && row < numRows) {
    const first = bytes[pos];
    pos += 1;

    let note: number | undefined;
    let instrument: number | undefined;
    let effect: number | undefined;
    let param = 0;

    if (first & 0x80) {
      if (first & 1) {
        note = bytes[pos];
        pos += 1;
      }
      if (first & 2) {
        instrument = bytes[pos];
        pos += 1;
      }
      if (first & 4) {
        // Volume column: read and discarded, as everywhere else.
        pos += 1;
      }
      if (first & 8) {
        effect = bytes[pos];
        pos += 1;
      }
      if (first & 16) {
        param = bytes[pos];
        pos += 1;
      }
    } else {
      note = first;
      instrument = bytes[pos];
      effect = bytes[pos + 2];
      param = bytes[pos + 3];
      pos += 4;
    }

    if (channel < channels) {
      const cell = rows[row][channel];
      if (note !== undefined) {
        if (note === 0) cell.note = null;
        else if (note === KEY_OFF) cell.note = 'off';
        else cell.note = note + NOTE_BASE;
      }
      if (instrument !== undefined) cell.instrument = instrument;
      if (effect !== undefined) applyProTrackerEffect(cell, effect, param);
    }

    channel += 1;
    if (channel >= channels) {
      channel = 0;
      row += 1;
    }
  }

  return { rows, next: start + packedSize };
}
```

and in `readXm`, replace the placeholder patterns:

```ts
  const numPatterns = view.getUint16(70, true);
  let at = HEADER_SIZE_AT + headerSize;
  const patterns: TrackerCell[][][] = [];
  for (let p = 0; p < numPatterns && at + 9 <= bytes.length; p += 1) {
    const { rows, next } = readPattern(bytes, view, at, channels);
    patterns.push(rows);
    at = next;
  }
```

removing the `void headerSize;` line and the placeholder `const patterns` declaration.

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/shared/tracker/xm.test.ts`
Expected: PASS.

- [ ] **Step 5: Sabotage check**

In `readPattern`, change the uncompressed branch to treat every byte as a mask — delete the `else` and always run the mask path. Expected: "unpacks an uncompressed event, where the byte itself is the note" FAILS. Restore.

- [ ] **Step 6: Second sabotage check**

Change `Array.from({ length: numRows }, …)` to `Array.from({ length: 64 }, …)`. Expected: "honours each pattern its own row count" FAILS. Restore.

---

### Task 4: Instrument walking — the trap

**Files:**
- Modify: `src/shared/tracker/xm.ts`, `src/shared/tracker/xm.test.ts`

**Interfaces:**
- Produces: no new exports; `readXm` returns populated instruments.

This is the task the whole plan exists for. `sunlight.xm` mixes 33-byte and 263-byte instrument headers, and a reader that assumes either one loses every instrument after the first of the other kind.

- [ ] **Step 1: Write the failing tests**

```ts
describe('readXm: instruments', () => {
  it('reads instrument names', () => {
    const xm = readXm(
      buildXm({ instruments: [{ name: 'fndr  -|', samples: 1 }, { name: 'sunshine', samples: 1 }] }),
    );
    expect(xm.instruments[0]).toEqual({ index: 1, name: 'fndr  -|' });
    expect(xm.instruments[1]).toEqual({ index: 2, name: 'sunshine' });
  });

  it('seeks past an instrument with no samples, whose header is 33 bytes not 263', () => {
    // The trap. sunlight.xm has eight empty instruments among fifteen; a reader
    // that assumes 263 loses every instrument after the first empty one.
    const xm = readXm(
      buildXm({
        instruments: [
          { name: 'first', samples: 1 },
          { name: 'empty', samples: 0 },
          { name: 'third', samples: 1 },
        ],
      }),
    );
    expect(xm.instruments.map((i) => i.name)).toEqual(['first', 'empty', 'third']);
  });

  it('seeks past sample data of any size to find the next instrument', () => {
    const xm = readXm(
      buildXm({
        instruments: [
          { name: 'big', samples: 1, sampleLengths: [4096] },
          { name: 'after', samples: 1, sampleLengths: [8] },
        ],
      }),
    );
    expect(xm.instruments.map((i) => i.name)).toEqual(['big', 'after']);
  });

  it('seeks past an instrument with several samples', () => {
    const xm = readXm(
      buildXm({
        instruments: [
          { name: 'multi', samples: 3, sampleLengths: [16, 32, 64] },
          { name: 'after', samples: 1 },
        ],
      }),
    );
    expect(xm.instruments.map((i) => i.name)).toEqual(['multi', 'after']);
  });

  it('finds the instruments at all, which means it walked every pattern first', () => {
    // Instruments follow the patterns, so a pattern-walking bug shows up here
    // as garbage names rather than as a pattern failure.
    const xm = readXm(
      buildXm({
        patterns: [{ rows: 64 }, { rows: 76 }, { rows: 32, empty: true }],
        instruments: [{ name: 'reached', samples: 1 }],
      }),
    );
    expect(xm.instruments[0].name).toBe('reached');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- src/shared/tracker/xm.test.ts`
Expected: FAIL — instruments are empty.

- [ ] **Step 3: Implement**

Add to `src/shared/tracker/xm.ts`:

```ts
/**
 * One instrument, and where the next one starts.
 *
 * The size arithmetic is the whole difficulty of this format:
 *
 *     next = start + instrumentHeaderSize
 *                  + numSamples * sampleHeaderSize
 *                  + the sum of every sample's length
 *
 * All three parts are read from the file. `instrumentHeaderSize` in particular
 * is **not** a constant — an instrument with no samples writes 33 bytes where
 * one with samples writes 263, and real modules mix them freely.
 *
 * Sample data is only ever measured, never read.
 */
function readInstrument(
  bytes: Uint8Array,
  view: DataView,
  at: number,
  index: number,
): { instrument: TrackerInstrument; next: number } {
  const headerSize = view.getUint32(at, true);
  const name = ascii(bytes, at + INSTRUMENT_NAME_AT, INSTRUMENT_NAME_LENGTH);
  const numSamples = view.getUint16(at + NUM_SAMPLES_AT, true);

  let next = at + headerSize;
  if (numSamples > 0 && at + SAMPLE_HEADER_SIZE_AT + 4 <= bytes.length) {
    const sampleHeaderSize = view.getUint32(at + SAMPLE_HEADER_SIZE_AT, true);
    let total = 0;
    for (let s = 0; s < numSamples; s += 1) {
      const headerAt = next + s * sampleHeaderSize;
      if (headerAt + 4 > bytes.length) break;
      total += view.getUint32(headerAt, true);
    }
    next += numSamples * sampleHeaderSize + total;
  }

  return { instrument: { index, name }, next };
}
```

and in `readXm`, after the pattern loop:

```ts
  const numInstruments = view.getUint16(72, true);
  const instruments: TrackerInstrument[] = [];
  for (let i = 0; i < numInstruments && at + 4 <= bytes.length; i += 1) {
    const { instrument, next } = readInstrument(bytes, view, at, i + 1);
    instruments.push(instrument);
    at = next;
  }
```

replacing the placeholder `const instruments` declaration from Task 2.

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/shared/tracker/xm.test.ts`
Expected: PASS.

- [ ] **Step 5: Sabotage check**

Replace `const headerSize = view.getUint32(at, true);` with `const headerSize = 263;`. Expected: "seeks past an instrument with no samples, whose header is 33 bytes not 263" FAILS. Restore.

- [ ] **Step 6: Second sabotage check**

Delete `total` from the `next` calculation, leaving `next += numSamples * sampleHeaderSize;`. Expected: "seeks past sample data of any size to find the next instrument" FAILS. Restore.

---

### Task 5: Format detection

**Files:**
- Modify: `src/shared/mod/codec.ts`, `src/shared/mod/codec.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/shared/mod/codec.test.ts`:

```ts
import { buildXm } from '../tracker/xm-fixture.js';

it('decodes a FastTracker module', () => {
  expect(new SharedTrackerCodec().decode(buildXm({ title: 'sunlight' })).format).toBe('xm');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test -- src/shared/mod/codec.test.ts`
Expected: FAIL — falls through to `readMod`, which rejects it.

- [ ] **Step 3: Implement**

In `SharedTrackerCodec.decode`, add before the MOD fallback:

```ts
    // 17 characters, so not a fourCC — checked as a string prefix.
    if (asciiAt(view, 0, 17) === 'Extended Module: ') return readXm(bytes);
```

with a small helper beside `fourCC`:

```ts
function asciiAt(bytes: Uint8Array, at: number, length: number): string {
  if (at + length > bytes.length) return '';
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[at + i]);
  return out;
}
```

and import `readXm` from `../tracker/xm.js`.

- [ ] **Step 4: Run the suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 5: Sabotage check**

Change the prefix to `'Extended Module:'` (16 characters, no trailing space) while leaving the length at 17. Expected: "decodes a FastTracker module" FAILS. Restore.

---

### Task 6: Real files, the app, and shipping

**Files:**
- Add: `src/shared/tracker/fixtures/sunlight.xm`, `src/shared/tracker/fixtures/dr_wily.xm`
- Modify: `src/shared/tracker/fixtures/README.md`, `src/shared/tracker/acceptance.test.ts`
- Modify: `music_app/src/features/projects/DashboardPage.tsx`
- Modify: `music_io/CLAUDE.md`, `music_app/CLAUDE.md`

- [ ] **Step 1: Add the fixtures**

```bash
cd /Users/johnhuang/projects/music_io
curl -sL -A "Mozilla/5.0" "https://api.modarchive.org/downloads.php?moduleid=142447" \
  -o src/shared/tracker/fixtures/sunlight.xm
curl -sL -A "Mozilla/5.0" "https://api.modarchive.org/downloads.php?moduleid=58823" \
  -o src/shared/tracker/fixtures/dr_wily.xm
```

Add both to the provenance table in the README, with a line saying why each is kept: `sunlight.xm` mixes 33-byte and 263-byte instrument headers (eight empty instruments among fifteen), and `dr_wily.xm` holds a 76-row pattern and four empty ones. `mercury.xm` and `1funk.xm` were measured during design but are 1.1 MB and 777 KB and cover nothing these two do not.

- [ ] **Step 2: Run the existing acceptance test**

Run: `bun run test -- src/shared/tracker/acceptance.test.ts`
Expected: PASS for all six files. It already asserts every row is `module.channels` wide and every note is inside MIDI's range.

- [ ] **Step 3: Assert the XM findings explicitly**

Append to `src/shared/tracker/acceptance.test.ts`:

```ts
import { readXm } from './xm.js';

describe('XM real-world findings', () => {
  const load = (name: string) => {
    const buf = readFileSync(`${DIR}${name}`);
    return readXm(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  };

  it('reads every instrument past the empty ones', () => {
    // sunlight.xm has eight instruments with no samples among fifteen. A reader
    // assuming a 263-byte header loses everything after the first of them.
    const xm = load('sunlight.xm');
    expect(xm.instruments).toHaveLength(15);
    expect(xm.instruments.filter((i) => i.name.length > 0).length).toBeGreaterThan(1);
  });

  it('gives each pattern its own row count', () => {
    const xm = load('dr_wily.xm');
    const lengths = new Set(xm.patterns.map((p) => p.length));
    expect(lengths.has(64)).toBe(true);
    expect(lengths.has(76)).toBe(true);
  });

  it('gives an empty pattern its declared rows rather than none', () => {
    const xm = load('dr_wily.xm');
    for (const pattern of xm.patterns) expect(pattern.length).toBeGreaterThan(0);
  });

  it('finds key offs, which no earlier format had in a real file', () => {
    const offs = load('sunlight.xm')
      .patterns.flat(2)
      .filter((c) => c.note === 'off');
    expect(offs.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Check the whole import path end to end**

```bash
cat > src/shared/tracker/__check.test.ts <<'EOF'
import { expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { trackerToScore, validateScore } from '@sudobility/music_lib';
import { SharedTrackerCodec } from '../mod/codec.js';

const DIR = new URL('./fixtures/', import.meta.url).pathname;
for (const name of readdirSync(DIR).filter((f) => !f.endsWith('.md'))) {
  it(`turns ${name} into a valid score`, () => {
    const buf = readFileSync(`${DIR}${name}`);
    const module = new SharedTrackerCodec().decode(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    );
    const score = trackerToScore(module);
    const issues = validateScore(score);
    // eslint-disable-next-line no-console
    console.log(`${name}: ch=${module.channels} pat=${module.patterns.length} tracks=${score.tracks.length} measures=${score.tracks[0]?.measures.length} issues=${issues.length}`);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(issues.filter((i) => i.code === 'measure-underfull')).toEqual([]);
  });
}
EOF
rsync -a --delete ../music_lib/dist/ node_modules/@sudobility/music_lib/dist/
npx vitest run src/shared/tracker/__check.test.ts --silent=false --disable-console-intercept
rm src/shared/tracker/__check.test.ts
```

Expected: `issues=0` for all six. **The `rsync` matters** — `music_io`'s copy of `music_lib` is what this resolves, and it goes stale silently.

If an XM produces `invalid-tempo-bpm`, that is the clamp added during the S3M work doing its job or failing to; read the message before assuming.

- [ ] **Step 5: Verify and propagate**

```bash
bun run verify
bun run clean && bun run build
for c in music_lib music_app; do rsync -a --delete dist/ ../$c/node_modules/@sudobility/music_io/dist/; done
rm -rf ../music_app/node_modules/.vite
```

- [ ] **Step 6: Accept `.xm` in the app**

In `music_app/src/features/projects/DashboardPage.tsx`:

```tsx
accept=".mod,.dsm,.s3m,.xm,audio/mod,application/octet-stream"
```

The tooltip reads `Import a tracker module (.MOD, .DSM, .S3M)` and the dialog description names the same three; both become `.MOD, .DSM, .S3M, .XM`.

- [ ] **Step 7: Update the docs**

`music_io/CLAUDE.md`: XM's headers declare their own sizes and the instrument one varies within a file (33 without samples, 263 with) — with the module id that proves it; patterns carry their own row count, the first format here that is not fixed at 64; `packedSize = 0` means blank rows rather than none; and XM reuses `applyProTrackerEffect` because its `F` splits at `0x20` exactly as MOD's does, verified against four files.

`music_app/CLAUDE.md`: the import gotcha now lists `.mod`, `.dsm`, `.s3m` and `.xm`.

- [ ] **Step 8: Deploy**

```bash
cd /Users/johnhuang/projects/music_app && ./scripts/push_all.sh
```

If a downstream repo fails typecheck on a symbol that exists in the source it was just built against, that is the npm publish race the script's own comments describe: poll `npm view @sudobility/<pkg> version`, `bun update` it, and resume with `--starting-project <name>`.

- [ ] **Step 9: Report back**

Say what both XM fixtures imported as, whether the instrument-header sabotage genuinely failed the empty-instrument test, and anything the measured offsets got wrong. The next plan is IT — the last format, and the one MPTM rides on.

---

## Self-Review Notes

**Spec coverage:** §2's XM row → Tasks 1–4. Magic detection → Task 5. §7's real-file fixtures → Task 6. §1 and §3 untouched by design — XM is the third consecutive format needing no change to the neutral model, and the first to exercise its per-pattern row count.

**Deliberately out of scope:** IT and MPTM; moving MOD into `src/shared/tracker/`; renaming the `modCodec` service property; XM's instrument envelopes, panning and relative-note fields, none of which notation import reads.

**Known unknowns:** XM's *relative note* and *finetune* per sample would shift pitches, and this reader ignores both — every note is read at its written value. No file in the corpus was checked for a non-zero relative note, so a module using it will import transposed. Recorded here rather than discovered later; the same class of limitation as MOD's finetune.

**Type consistency, checked:** `readXm(buffer: ArrayBuffer)` matches its call in Tasks 5 and 6. `readPattern` and `readInstrument` both return `{ …, next: number }` and are consumed that way. `buildXm`'s options match their uses in Tasks 2, 3, 4 and 5. `NOTE_BASE` is 11 here, matching DSM's linear numbering and deliberately *not* S3M's 12, which compensates for that format packing an octave into the high nibble.
