# DSM Decoder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import DSIK/DSMI `.dsm` modules, as the second format on the neutral `TrackerModule` — proving the model holds without changing it.

**Architecture:** A RIFF chunk walker, a DSM reader built on it, and a shared ProTracker-effect normaliser that MOD moves onto too (DSM uses the same effect semantics). `SharedTrackerCodec` gains magic-byte detection to choose between readers. No change to `TrackerModule` or to `trackerToScore` — if either needs one, the model was wrong and that is worth knowing now rather than after four more decoders.

**Tech Stack:** TypeScript (strict, ESM, extensionless relative imports built by `tsc`), Vitest.

## Global Constraints

- **Repos:** `music_io` for everything except the final app copy change and docs. `music_types` and `music_lib` are **not** touched — that is the point of this plan.
- **Relative imports carry a `.js` extension** even from `.ts` files. House style; do not "fix" it.
- **Cross-repo propagation:** after changing `music_io` run `bun run clean && bun run build`, `rsync -a --delete dist/ ../<consumer>/node_modules/@sudobility/music_io/dist/` for both `music_lib` and `music_app`, then `rm -rf ../music_app/node_modules/.vite`.
- **`music_io` does bytes, `music_lib` does music.** The reader returns a `TrackerModule` and stops. Nothing musical belongs here.
- **Sample payloads are skipped, never decoded.** DSM stores raw PCM inside each `INST` chunk; the chunk walker steps over it by length. No audio is read.
- **Verify by sabotage.** After each task's tests pass, break the implementation line the test targets, confirm that test fails, restore.
- **Spec:** `docs/superpowers/specs/2026-08-17-tracker-formats-design.md`.
- **Do not commit manually.** When the plan says deploy, run `music_app/scripts/push_all.sh`.

## Format facts, verified against a real file

Every offset below was measured against `flying_tigers_-_race_against_time.dsm` (modarchive id 214766), not taken from a specification. Two of them contradict the commonly cited layout, which is why they were measured.

**Container.** `RIFF` at 0, uint32 LE length at 4 (excludes the 8-byte header — measured 106301 for a 106309-byte file), `DSMF` at 8. Then chunks from offset 12: 4-byte id, uint32 LE length, payload. The sample file holds 1 `SONG`, 24 `PATT`, 31 `INST`.

**`SONG` payload, 192 bytes:**

| Offset | Type       | Field         | Measured                |
| ------ | ---------- | ------------- | ----------------------- |
| 0      | char[28]   | title         | `Race against time`     |
| 28     | uint16     | version       | 0                       |
| 30     | uint16     | flags         | 0                       |
| 32     | uint16     | orderPos      | 0                       |
| 34     | uint16     | restartPos    | 127                     |
| **36** | uint16     | **numOrders** | 31                      |
| 38     | uint16     | numSamples    | 31 (= 31 `INST` chunks) |
| 40     | uint16     | numPatterns   | 24 (= 24 `PATT` chunks) |
| 42     | uint16     | numChannels   | 4                       |
| 44     | uint8      | globalVolume  | 64                      |
| 45     | uint8      | masterVolume  | 192                     |
| 46     | uint8      | initSpeed     | 6                       |
| 47     | uint8      | initBPM       | 125                     |
| 48     | uint8[16]  | channelPan    | `[0,128,128,0,0…]`      |
| 64     | uint8[128] | orders        | 31 used, max 23         |

`numOrders` sits at **+36**, not +34 as often documented. The order list read from +64 gave 31 entries with a maximum of 23, exactly `numPatterns - 1`; reading it at +34 gives 127, which is `restartPos`.

**`INST` payload, 64-byte header then raw PCM:**

| Offset | Type     | Field                        |
| ------ | -------- | ---------------------------- |
| 0      | char[13] | filename                     |
| 13     | uint16   | flags                        |
| 15     | uint8    | volume                       |
| 16     | uint32   | length                       |
| 20     | uint32   | loopStart                    |
| 24     | uint32   | loopEnd                      |
| 28     | uint32   | reserved                     |
| 32     | uint16   | c2spd                        |
| 34     | uint16   | period                       |
| **36** | char[28] | **name**                     |
| 64     |          | sample data (`length` bytes) |

Confirmed by arithmetic: `64 + length` equalled the chunk length for all 31 instruments, and reading +36 gave real names — `Blast`, `Poly`, `Beep`, `Swisch`, `Snare`, `Saw`, `String`, `Symph`.

**`PATT` payload:** uint16 LE at 0 giving the chunk's own byte length (measured 1012, equal to the chunk length), then packed rows from offset 2. Per event:

- Read a flag byte. **Zero ends the row.**
- `flag & 0x0f` is the channel.
- `flag & 0x80` → a note byte follows.
- `flag & 0x40` → an instrument byte follows.
- `flag & 0x20` → a volume byte follows.
- `flag & 0x10` → an effect byte and a parameter byte follow.

All 24 patterns unpacked to exactly 64 rows consuming exactly their chunk, byte for byte.

**Effects are ProTracker's.** Effect `0x0F` appeared with parameters 5 and 114 — speed below `0x20`, tempo above, exactly MOD's rule. So `F` and `D` normalise identically to MOD's and that logic is shared rather than rewritten.

**The one unknown.** Note bytes in this file span 41–72 with no `254`/`255`, so it contains **no note-off** and cannot pin the note base or the note-off encoding. Task 5 Step 6 verifies the base against a reference player rather than asserting it; the code carries a named constant and a comment saying it is unconfirmed.

---

## File Structure

| File                                                    | Responsibility                                 | Change                                   |
| ------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------- |
| `src/shared/tracker/riff.ts`                            | RIFF chunk walking                             | **Create**                               |
| `src/shared/tracker/riff.test.ts`                       |                                                | **Create**                               |
| `src/shared/tracker/protracker-effects.ts`              | `F`/`D` → neutral `speed`/`bpm`/`patternBreak` | **Create** (MOD moves onto it)           |
| `src/shared/tracker/protracker-effects.test.ts`         |                                                | **Create**                               |
| `src/shared/tracker/dsm.ts`                             | the DSM reader                                 | **Create**                               |
| `src/shared/tracker/dsm.test.ts`                        |                                                | **Create**                               |
| `src/shared/tracker/dsm-fixture.ts`                     | hand-built DSM buffer                          | **Create**                               |
| `src/shared/mod/read.ts`                                | MOD reader                                     | Modify: use the shared effect normaliser |
| `src/shared/mod/codec.ts`                               | `SharedTrackerCodec`                           | Modify: magic-byte detection             |
| `src/shared/mod/codec.test.ts`                          |                                                | **Create**                               |
| `src/shared/tracker/fixtures/`                          | real modules                                   | **Create** — see Task 6                  |
| `music_app/src/features/projects/DashboardPage.tsx:676` | file input `accept`                            | Modify: add `.dsm`                       |

**On directory naming:** new decoders go in `src/shared/tracker/`; MOD stays in `src/shared/mod/` for now. Moving it is a pure rename touching three barrel files, and doing it while four more decoders are still unwritten risks conflicting with them. Move it when the last decoder lands, as one change.

---

### Task 1: RIFF chunk walking

**Files:**

- Create: `src/shared/tracker/riff.ts`, `src/shared/tracker/riff.test.ts`

**Interfaces:**

- Produces:

```ts
export type RiffChunk = { id: string; start: number; length: number };
/** Walks `RIFF`/`<form>` chunks. Throws if the header is not that form. */
export function readRiffChunks(bytes: Uint8Array, form: string): RiffChunk[];
```

`start` is the offset of the chunk's **payload**, not its header — so a caller never has to remember to add 8.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { readRiffChunks } from './riff.js';

/** A RIFF file of `[id, payloadLength]` chunks, payloads filled with the chunk index. */
function riff(form: string, chunks: Array<[string, number]>): Uint8Array {
  const body = chunks.reduce((n, [, len]) => n + 8 + len, 0);
  const out = new Uint8Array(12 + body);
  const view = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < 4; i += 1) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 4 + body, true);
  ascii(8, form);
  let at = 12;
  chunks.forEach(([id, len], index) => {
    ascii(at, id);
    view.setUint32(at + 4, len, true);
    out.fill(index + 1, at + 8, at + 8 + len);
    at += 8 + len;
  });
  return out;
}

describe('readRiffChunks', () => {
  it('lists every chunk with its payload offset and length', () => {
    const chunks = readRiffChunks(
      riff('DSMF', [
        ['SONG', 4],
        ['PATT', 8],
      ]),
      'DSMF',
    );
    expect(chunks).toEqual([
      { id: 'SONG', start: 20, length: 4 },
      { id: 'PATT', start: 32, length: 8 },
    ]);
  });

  it('gives a payload offset that points at the payload, not the header', () => {
    const bytes = riff('DSMF', [['SONG', 4]]);
    const [song] = readRiffChunks(bytes, 'DSMF');
    // The builder fills the first chunk's payload with 1s.
    expect(bytes[song.start]).toBe(1);
  });

  it('rejects a file that is not RIFF at all', () => {
    expect(() => readRiffChunks(new Uint8Array(64), 'DSMF')).toThrow(/riff/i);
  });

  it('rejects the right RIFF of the wrong form', () => {
    expect(() => readRiffChunks(riff('WAVE', [['fmt ', 4]]), 'DSMF')).toThrow(/DSMF/);
  });

  it('stops at a chunk whose length runs past the end rather than reading rubbish', () => {
    const bytes = riff('DSMF', [['SONG', 4]]);
    new DataView(bytes.buffer).setUint32(16, 9999, true);
    expect(readRiffChunks(bytes, 'DSMF')).toEqual([]);
  });

  it('handles a file with no chunks', () => {
    expect(readRiffChunks(riff('DSMF', []), 'DSMF')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- src/shared/tracker/riff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Walking a RIFF container.
 *
 * DSM is the only tracker format in this family built on RIFF, but the walking
 * is generic and worth having apart from the format that needs it — the reader
 * then contains only DSM's own decisions.
 *
 * A chunk whose declared length runs past the end of the file stops the walk
 * rather than throwing: a truncated module should yield whatever was actually
 * complete, and the reader above decides whether that is enough to be a module.
 */

export type RiffChunk = {
  id: string;
  /** Offset of the chunk's *payload*, so a caller never has to remember to add 8. */
  start: number;
  length: number;
};

const HEADER_BYTES = 12;

function fourCC(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

export function readRiffChunks(bytes: Uint8Array, form: string): RiffChunk[] {
  if (bytes.length < HEADER_BYTES || fourCC(bytes, 0) !== 'RIFF') {
    throw new Error('Not a RIFF file');
  }
  const actual = fourCC(bytes, 8);
  if (actual !== form) {
    throw new Error(`Not a ${form} file: RIFF form is "${actual}"`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: RiffChunk[] = [];
  let at = HEADER_BYTES;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at + 4, true);
    if (at + 8 + length > bytes.length) break;
    chunks.push({ id: fourCC(bytes, at), start: at + 8, length });
    at += 8 + length;
  }
  return chunks;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/shared/tracker/riff.test.ts`
Expected: PASS.

- [ ] **Step 5: Sabotage check**

Change `start: at + 8` to `start: at`. Expected: both the offset test and the payload test FAIL. Restore.

---

### Task 2: ProTracker effect normalisation, shared

**Files:**

- Create: `src/shared/tracker/protracker-effects.ts`, `src/shared/tracker/protracker-effects.test.ts`
- Modify: `src/shared/mod/read.ts`

**Interfaces:**

- Produces:

```ts
/** Writes the neutral speed/bpm/patternBreak fields a ProTracker-style effect implies. */
export function applyProTrackerEffect(cell: TrackerCell, effect: number, param: number): void;
```

**Why shared:** measured on the real DSM file, effect `0x0F` carries parameter 5 and 114 — speed below `0x20`, tempo above, which is MOD's exact rule. DSM inherited ProTracker's effect lettering because it exists largely to carry converted MODs. Writing it twice would mean two places to fix when S3M's different lettering forces a decision.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import type { TrackerCell } from '@sudobility/music_types';
import { applyProTrackerEffect } from './protracker-effects.js';

const cell = (): TrackerCell => ({ instrument: 0, note: null });

describe('applyProTrackerEffect', () => {
  it('reads F below 0x20 as ticks per row', () => {
    const c = cell();
    applyProTrackerEffect(c, 0xf, 0x06);
    expect(c.speed).toBe(6);
    expect(c.bpm).toBeUndefined();
  });

  it('reads F at or above 0x20 as beats per minute', () => {
    const c = cell();
    applyProTrackerEffect(c, 0xf, 0x7d);
    expect(c.bpm).toBe(125);
    expect(c.speed).toBeUndefined();
  });

  it('reads D as a pattern break', () => {
    const c = cell();
    applyProTrackerEffect(c, 0xd, 0x00);
    expect(c.patternBreak).toBe(true);
  });

  it('leaves the cell alone for an effect notation import does not use', () => {
    // Portamento, vibrato, arpeggio and the rest have no bearing on notation.
    const c = cell();
    applyProTrackerEffect(c, 0x4, 0x42);
    expect(c).toEqual({ instrument: 0, note: null });
  });

  it('ignores F00, which sets nothing', () => {
    const c = cell();
    applyProTrackerEffect(c, 0xf, 0x00);
    expect(c.speed).toBeUndefined();
    expect(c.bpm).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- src/shared/tracker/protracker-effects.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * ProTracker-style effects, reduced to what notation import uses.
 *
 * Which is very little: speed, tempo and the pattern break. Portamento,
 * vibrato and arpeggio shape a performance, not a score, and the neutral cell
 * has nowhere to put them by design.
 *
 * Shared by MOD and DSM because DSM inherited ProTracker's lettering — it
 * exists largely to carry converted MODs, and the real file this was measured
 * against uses `F` with exactly ProTracker's split. S3M, XM and IT letter their
 * effects differently and will bring their own normalisers.
 */
import type { TrackerCell } from '@sudobility/music_types';

/** Effect F: at or below this the parameter is speed; above it, tempo. */
const SPEED_LIMIT = 0x1f;

export function applyProTrackerEffect(cell: TrackerCell, effect: number, param: number): void {
  if (effect === 0xf) {
    // F00 sets neither knob; trackers treat it as a no-op.
    if (param === 0) return;
    if (param <= SPEED_LIMIT) cell.speed = param;
    else cell.bpm = param;
    return;
  }
  if (effect === 0xd) cell.patternBreak = true;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/shared/tracker/protracker-effects.test.ts`
Expected: PASS.

- [ ] **Step 5: Move MOD onto it**

In `src/shared/mod/read.ts`, replace the inline effect block:

```ts
// Effect F carries both knobs: at or below 0x1f the parameter is
// speed (ticks per row), above it the tempo in BPM.
if (effect === 0xf) {
  if (param <= 0x1f) cell.speed = param;
  else cell.bpm = param;
}
// Effect D ends the pattern on this row. Ignored before this, which is
// why a module using breaks imported with too many bars.
if (effect === 0xd) cell.patternBreak = true;
```

with:

```ts
// DSM letters its effects the same way, so this is shared.
applyProTrackerEffect(cell, effect, param);
```

and import it from `../tracker/protracker-effects.js`.

- [ ] **Step 6: Run the whole suite**

Run: `bun run test`
Expected: PASS, including `read.test.ts`'s existing F and D cases — which is the point: the shared version must behave identically. One difference is deliberate and may surface: the shared version ignores `F00` where the inline one did not. If a MOD test asserts `F00` sets speed 0, delete it — speed 0 is not a tempo and the old behaviour was a latent bug.

- [ ] **Step 7: Sabotage check**

Change `SPEED_LIMIT` to `0xff`. Expected: "reads F at or above 0x20 as beats per minute" FAILS, and MOD's equivalent test fails too. Restore.

---

### Task 3: The DSM song header

**Files:**

- Create: `src/shared/tracker/dsm.ts`, `src/shared/tracker/dsm-fixture.ts`, `src/shared/tracker/dsm.test.ts`

**Interfaces:**

- Consumes: `readRiffChunks` (Task 1).
- Produces: `readDsm(buffer: ArrayBuffer): TrackerModule`, and from the fixture module `buildDsm(opts): ArrayBuffer`.

- [ ] **Step 1: Write the fixture builder**

Create `src/shared/tracker/dsm-fixture.ts`. It must produce byte-for-byte what the measured layout describes, because it is the only thing standing between a wrong offset and a green suite:

```ts
/**
 * A hand-built DSM file, for testing the reader against known bytes.
 *
 * Offsets here mirror the ones measured from a real module (see the plan and
 * `dsm.ts`); if the reader and this builder ever drift apart they will agree
 * with each other and disagree with reality, so the acceptance test against a
 * real file is what keeps them honest.
 */

export type DsmCellSpec = {
  channel: number;
  note?: number;
  instrument?: number;
  volume?: number;
  effect?: number;
  param?: number;
};

export type DsmOptions = {
  title?: string;
  channels?: number;
  instrumentNames?: string[];
  order?: number[];
  /** `patterns[p][row]` — a list of events for that row. */
  patterns?: DsmCellSpec[][][];
  initSpeed?: number;
  initBPM?: number;
};

function ascii(out: Uint8Array, at: number, text: string, length: number): void {
  for (let i = 0; i < length; i += 1) out[at + i] = i < text.length ? text.charCodeAt(i) : 0;
}

/** One packed pattern payload: a uint16 self-length, then rows terminated by a zero byte. */
function packPattern(rows: DsmCellSpec[][]): Uint8Array {
  const body: number[] = [];
  for (let row = 0; row < 64; row += 1) {
    for (const cell of rows[row] ?? []) {
      let flag = cell.channel & 0x0f;
      if (cell.note !== undefined) flag |= 0x80;
      if (cell.instrument !== undefined) flag |= 0x40;
      if (cell.volume !== undefined) flag |= 0x20;
      if (cell.effect !== undefined) flag |= 0x10;
      body.push(flag);
      if (cell.note !== undefined) body.push(cell.note);
      if (cell.instrument !== undefined) body.push(cell.instrument);
      if (cell.volume !== undefined) body.push(cell.volume);
      if (cell.effect !== undefined) body.push(cell.effect, cell.param ?? 0);
    }
    body.push(0); // end of row
  }
  const out = new Uint8Array(2 + body.length);
  new DataView(out.buffer).setUint16(0, out.length, true);
  out.set(body, 2);
  return out;
}

export function buildDsm(opts: DsmOptions = {}): ArrayBuffer {
  const channels = opts.channels ?? 4;
  const names = opts.instrumentNames ?? [];
  const order = opts.order ?? [0];
  const patterns = opts.patterns ?? [[]];

  const song = new Uint8Array(192);
  const songView = new DataView(song.buffer);
  ascii(song, 0, opts.title ?? 'Fixture', 28);
  songView.setUint16(36, order.length, true);
  songView.setUint16(38, names.length, true);
  songView.setUint16(40, patterns.length, true);
  songView.setUint16(42, channels, true);
  song[44] = 64;
  song[45] = 192;
  song[46] = opts.initSpeed ?? 6;
  song[47] = opts.initBPM ?? 125;
  order.forEach((value, i) => {
    song[64 + i] = value;
  });

  const instruments = names.map((name) => {
    const chunk = new Uint8Array(64); // header only; no sample data
    new DataView(chunk.buffer).setUint32(16, 0, true); // length 0
    ascii(chunk, 36, name, 28);
    return chunk;
  });

  const packed = patterns.map(packPattern);
  const parts: Array<[string, Uint8Array]> = [
    ['SONG', song],
    ...packed.map((p): [string, Uint8Array] => ['PATT', p]),
    ...instruments.map((i): [string, Uint8Array] => ['INST', i]),
  ];

  const body = parts.reduce((n, [, data]) => n + 8 + data.length, 0);
  const out = new Uint8Array(12 + body);
  const view = new DataView(out.buffer);
  ascii(out, 0, 'RIFF', 4);
  view.setUint32(4, 4 + body, true);
  ascii(out, 8, 'DSMF', 4);
  let at = 12;
  for (const [id, data] of parts) {
    ascii(out, at, id, 4);
    view.setUint32(at + 4, data.length, true);
    out.set(data, at + 8);
    at += 8 + data.length;
  }
  return out.buffer;
}
```

- [ ] **Step 2: Write the failing header tests**

Create `src/shared/tracker/dsm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readDsm } from './dsm.js';
import { buildDsm } from './dsm-fixture.js';

describe('readDsm: song header', () => {
  it('reads the title, channel count and format', () => {
    const dsm = readDsm(buildDsm({ title: 'Race against time', channels: 4 }));
    expect(dsm.title).toBe('Race against time');
    expect(dsm.channels).toBe(4);
    expect(dsm.format).toBe('dsm');
  });

  it('reads the order list, trimmed to numOrders', () => {
    // The 128-byte order array is mostly junk past the count, exactly as MOD's is.
    const dsm = readDsm(buildDsm({ order: [1, 2, 0], patterns: [[], [], []] }));
    expect(dsm.order).toEqual([1, 2, 0]);
  });

  it('reads instrument names from offset 36 of the INST header', () => {
    const dsm = readDsm(buildDsm({ instrumentNames: ['Blast', 'Poly'] }));
    expect(dsm.instruments[0]).toEqual({ index: 1, name: 'Blast' });
    expect(dsm.instruments[1]).toEqual({ index: 2, name: 'Poly' });
  });

  it('rejects a file that is not a DSM', () => {
    expect(() => readDsm(new ArrayBuffer(64))).toThrow(/riff/i);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `bun run test -- src/shared/tracker/dsm.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the header half**

Create `src/shared/tracker/dsm.ts` with the container, `SONG` and `INST` handling. Leave `PATT` returning empty patterns for now — Task 4 fills it in:

```ts
/**
 * Reading a DSIK/DSMI module into the neutral tracker model.
 *
 * A RIFF container of `SONG`, `INST` and `PATT` chunks. Structurally the
 * simplest format in the family, which is why it is the first one added after
 * MOD: if it needed the model changed, the model was wrong.
 *
 * **Every offset here was measured against a real module** (modarchive 214766),
 * not taken from a specification — two of them contradict the commonly cited
 * layout. `numOrders` in particular sits at +36, where +34 is `restartPos`;
 * reading it there yields 127 rather than the true 31.
 *
 * Sample data is never read. It sits inside each `INST` chunk after a 64-byte
 * header and the chunk walker steps over it by length.
 */
import type { TrackerCell, TrackerInstrument, TrackerModule } from '@sudobility/music_types';
import { readRiffChunks } from './riff.js';

const SONG_BYTES = 192;
/** Sample data begins after this; the name sits at +36 inside it. */
const INST_HEADER_BYTES = 64;
const INST_NAME_AT = 36;
const INST_NAME_LENGTH = 28;
const ORDERS_AT = 64;

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const c = bytes[at + i];
    if (c === 0) break;
    if (c >= 32 && c < 127) out += String.fromCharCode(c);
  }
  return out.trim();
}

export function readDsm(buffer: ArrayBuffer): TrackerModule {
  const bytes = new Uint8Array(buffer);
  const chunks = readRiffChunks(bytes, 'DSMF');

  const songChunk = chunks.find((c) => c.id === 'SONG');
  if (!songChunk || songChunk.length < SONG_BYTES) {
    throw new Error('Not a DSM module: no SONG chunk');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const song = songChunk.start;

  const title = ascii(bytes, song, 28);
  const numOrders = view.getUint16(song + 36, true);
  const channels = view.getUint16(song + 42, true);

  const order: number[] = [];
  for (let i = 0; i < numOrders; i += 1) order.push(bytes[song + ORDERS_AT + i]);

  const instruments: TrackerInstrument[] = chunks
    .filter((c) => c.id === 'INST')
    .map((chunk, i) => ({
      index: i + 1,
      name:
        chunk.length >= INST_HEADER_BYTES
          ? ascii(bytes, chunk.start + INST_NAME_AT, INST_NAME_LENGTH)
          : '',
    }));

  const patterns: TrackerCell[][][] = chunks.filter((c) => c.id === 'PATT').map(() => []);

  return { format: 'dsm', title, channels, instruments, order, patterns };
}
```

- [ ] **Step 5: Run the tests**

Run: `bun run test -- src/shared/tracker/dsm.test.ts`
Expected: PASS.

- [ ] **Step 6: Sabotage check**

Change `song + 36` to `song + 34`. Expected: "reads the order list, trimmed to numOrders" FAILS — which is exactly the mistake the real-file measurement caught. Restore.

---

### Task 4: Pattern unpacking

**Files:**

- Modify: `src/shared/tracker/dsm.ts`, `src/shared/tracker/dsm.test.ts`

**Interfaces:**

- Consumes: `applyProTrackerEffect` (Task 2).
- Produces: no new exports; `readDsm` now returns populated patterns.

**Note numbering.** DSM stores a linear note number with 1 meaning C-0, so MIDI is `note + 11`. This is the one value the real file could not confirm — its notes span 41–72 with no special values — so the constant is named and Task 6 verifies it against a reference player.

- [ ] **Step 1: Write the failing tests**

```ts
describe('readDsm: pattern unpacking', () => {
  it('unpacks a cell into channel, note and instrument', () => {
    const dsm = readDsm(buildDsm({ patterns: [[[{ channel: 2, note: 49, instrument: 3 }]]] }));
    // Note 1 is C-0, so MIDI is note + 11.
    expect(dsm.patterns[0][0][2]).toMatchObject({ note: 60, instrument: 3 });
  });

  it('leaves untouched channels empty in that row', () => {
    const dsm = readDsm(buildDsm({ channels: 4, patterns: [[[{ channel: 1, note: 49 }]]] }));
    expect(dsm.patterns[0][0][0]).toEqual({ instrument: 0, note: null });
    expect(dsm.patterns[0][0][3]).toEqual({ instrument: 0, note: null });
  });

  it('produces 64 rows, each as wide as the channel count', () => {
    const dsm = readDsm(buildDsm({ channels: 4, patterns: [[[{ channel: 0, note: 49 }]]] }));
    expect(dsm.patterns[0]).toHaveLength(64);
    expect(dsm.patterns[0][0]).toHaveLength(4);
    expect(dsm.patterns[0][63]).toHaveLength(4);
  });

  it('normalises effect F into speed, as ProTracker does', () => {
    const dsm = readDsm(
      buildDsm({ patterns: [[[{ channel: 0, note: 49, effect: 0xf, param: 0x06 }]]] }),
    );
    expect(dsm.patterns[0][0][0].speed).toBe(6);
  });

  it('normalises effect F above 0x20 into bpm', () => {
    const dsm = readDsm(buildDsm({ patterns: [[[{ channel: 0, effect: 0xf, param: 0x72 }]]] }));
    expect(dsm.patterns[0][0][0].bpm).toBe(0x72);
  });

  it('marks a pattern break', () => {
    const dsm = readDsm(buildDsm({ patterns: [[[{ channel: 0, effect: 0xd }]]] }));
    expect(dsm.patterns[0][0][0].patternBreak).toBe(true);
  });

  it('reads a volume byte without mistaking it for anything else', () => {
    // The volume column is the one flag bit MOD has no equivalent for; getting
    // its position wrong shifts every following byte in the row.
    const dsm = readDsm(
      buildDsm({ patterns: [[[{ channel: 0, note: 49, volume: 40, effect: 0xf, param: 0x06 }]]] }),
    );
    expect(dsm.patterns[0][0][0]).toMatchObject({ note: 60, speed: 6 });
  });

  it('unpacks several events in one row, in channel order', () => {
    const dsm = readDsm(
      buildDsm({
        patterns: [
          [
            [
              { channel: 0, note: 49 },
              { channel: 2, note: 61 },
            ],
          ],
        ],
      }),
    );
    expect(dsm.patterns[0][0][0].note).toBe(60);
    expect(dsm.patterns[0][0][1].note).toBeNull();
    expect(dsm.patterns[0][0][2].note).toBe(72);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- src/shared/tracker/dsm.test.ts`
Expected: FAIL — patterns are empty.

- [ ] **Step 3: Implement**

Add to `src/shared/tracker/dsm.ts`:

```ts
/**
 * DSM's note numbering: 1 is C-0, so MIDI is the byte plus eleven.
 *
 * **Unconfirmed against a reference player.** The real module this reader was
 * measured against uses notes 41-72 with no special values, which fixes the
 * *spacing* but not the absolute base — every note would move together if this
 * is wrong by an octave.
 */
const NOTE_BASE = 11;
/** DSM patterns are a fixed 64 rows, as MOD's are. */
const ROWS_PER_PATTERN = 64;

const emptyCell = (): TrackerCell => ({ instrument: 0, note: null });

/**
 * One packed pattern.
 *
 * A flag byte per event, zero ending the row: the low nibble is the channel and
 * the high nibble says which of note, instrument, volume and effect follow.
 * Reading those four in the wrong order shifts every remaining byte in the row,
 * which is why the volume column has a test of its own — MOD has no equivalent
 * of it.
 */
function unpackPattern(
  bytes: Uint8Array,
  start: number,
  length: number,
  channels: number,
): TrackerCell[][] {
  const rows: TrackerCell[][] = [];
  // The payload opens with a uint16 of its own length, which the chunk header
  // already told us; skip it rather than trusting two sources.
  let at = start + 2;
  const end = start + length;

  while (rows.length < ROWS_PER_PATTERN) {
    const row: TrackerCell[] = Array.from({ length: channels }, emptyCell);
    while (at < end) {
      const flag = bytes[at];
      at += 1;
      if (flag === 0) break;

      const channel = flag & 0x0f;
      const cell = channel < channels ? row[channel] : emptyCell();
      if (flag & 0x80) {
        const note = bytes[at];
        at += 1;
        cell.note = note === 0 ? null : note + NOTE_BASE;
      }
      if (flag & 0x40) {
        cell.instrument = bytes[at];
        at += 1;
      }
      if (flag & 0x20) {
        // Read and discarded: a tracker volume column is a performance
        // instruction, and the score model has velocity for that at entry.
        at += 1;
      }
      if (flag & 0x10) {
        applyProTrackerEffect(cell, bytes[at], bytes[at + 1]);
        at += 2;
      }
    }
    rows.push(row);
    // A pattern whose data ended early still owes its remaining rows, or the
    // measure grid downstream comes out short.
    if (at >= end && rows.length < ROWS_PER_PATTERN) {
      while (rows.length < ROWS_PER_PATTERN) {
        rows.push(Array.from({ length: channels }, emptyCell));
      }
    }
  }
  return rows;
}
```

and replace the placeholder patterns line in `readDsm` with:

```ts
const patterns: TrackerCell[][][] = chunks
  .filter((c) => c.id === 'PATT')
  .map((chunk) => unpackPattern(bytes, chunk.start, chunk.length, channels));
```

Import `applyProTrackerEffect` from `./protracker-effects.js`.

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/shared/tracker/dsm.test.ts`
Expected: PASS.

- [ ] **Step 5: Sabotage check**

Delete the `if (flag & 0x20) { at += 1; }` block. Expected: "reads a volume byte without mistaking it for anything else" FAILS, because the effect bytes shift. Restore.

---

### Task 5: Format detection

**Files:**

- Modify: `src/shared/mod/codec.ts`
- Create: `src/shared/mod/codec.test.ts`

**Interfaces:**

- Consumes: `readDsm` (Tasks 3-4), `readMod`.
- Produces: `SharedTrackerCodec.decode` dispatching on magic bytes.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { SharedTrackerCodec } from './codec.js';
import { buildMod } from './fixture.js';
import { buildDsm } from '../tracker/dsm-fixture.js';

describe('SharedTrackerCodec', () => {
  const codec = new SharedTrackerCodec();

  it('decodes a ProTracker module', () => {
    expect(codec.decode(buildMod({ title: 'Elysium' })).format).toBe('mod');
  });

  it('decodes a DSM module', () => {
    expect(codec.decode(buildDsm({ title: 'Race' })).format).toBe('dsm');
  });

  it('chooses by magic bytes rather than by extension, which it never sees', () => {
    // A mis-named file still imports; that is the whole reason for sniffing.
    expect(codec.decode(buildDsm({})).format).toBe('dsm');
    expect(codec.decode(buildMod({})).format).toBe('mod');
  });

  it('names what it found when it recognises nothing', () => {
    const junk = new Uint8Array(2000);
    junk.set([0x50, 0x4b, 0x03, 0x04], 0); // a zip
    expect(() => codec.decode(junk.buffer)).toThrow(/not a .*module/i);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- src/shared/mod/codec.test.ts`
Expected: FAIL — the DSM case decodes as MOD or throws.

- [ ] **Step 3: Implement**

```ts
import type { TrackerCodec, TrackerModule } from '@sudobility/music_types';
import { readMod } from './read.js';
import { readDsm } from '../tracker/dsm.js';

function fourCC(bytes: Uint8Array, at: number): string {
  if (at + 4 > bytes.length) return '';
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

export class SharedTrackerCodec implements TrackerCodec {
  /**
   * Chooses a reader by magic bytes, never by file extension.
   *
   * A mis-named module still imports, and an unrecognised file fails saying
   * what was actually at the front of it rather than "parse error".
   */
  decode(bytes: ArrayBuffer): TrackerModule {
    const view = new Uint8Array(bytes);
    if (fourCC(view, 0) === 'RIFF' && fourCC(view, 8) === 'DSMF') return readDsm(bytes);
    // MOD's magic sits at 1080, past the header, and `readMod` validates it —
    // so it is the fallback rather than something sniffed twice.
    return readMod(bytes);
  }
}
```

- [ ] **Step 4: Run the tests and the suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 5: Sabotage check**

Change `'DSMF'` to `'WAVE'`. Expected: "decodes a DSM module" FAILS. Restore.

---

### Task 6: Real files, the note base, and shipping

**Files:**

- Create: `src/shared/tracker/fixtures/` with real modules and a `README.md`
- Create: `src/shared/tracker/acceptance.test.ts`
- Modify: `music_app/src/features/projects/DashboardPage.tsx:676`
- Modify: `music_io/CLAUDE.md`, `music_app/CLAUDE.md`

- [ ] **Step 1: Add the fixture corpus**

```bash
mkdir -p src/shared/tracker/fixtures
curl -sL -A "Mozilla/5.0" "https://api.modarchive.org/downloads.php?moduleid=214766" \
  -o src/shared/tracker/fixtures/race_against_time.dsm
curl -sL -A "Mozilla/5.0" "https://api.modarchive.org/downloads.php?moduleid=80555" \
  -o src/shared/tracker/fixtures/1995.mod
```

Write `src/shared/tracker/fixtures/README.md` recording, for each file, its modarchive module id, title, author and format — so provenance is traceable. State plainly that these are their authors' copyright, downloadable from modarchive but not obviously licensed for redistribution, and that committing them was a deliberate decision by the repository owner.

Prefer the smallest file that exercises a format when adding more.

- [ ] **Step 2: Write the acceptance test**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { SharedTrackerCodec } from '../mod/codec.js';

const DIR = new URL('./fixtures/', import.meta.url).pathname;

describe('real modules', () => {
  const codec = new SharedTrackerCodec();
  for (const name of readdirSync(DIR).filter((f) => !f.endsWith('.md'))) {
    it(`decodes ${name}`, () => {
      const buf = readFileSync(`${DIR}${name}`);
      const module = codec.decode(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      );
      expect(module.channels).toBeGreaterThan(0);
      expect(module.patterns.length).toBeGreaterThan(0);
      expect(module.order.length).toBeGreaterThan(0);
      // Every row is as wide as the module says it is: a packing bug usually
      // shows up here first, as a short or ragged row.
      for (const pattern of module.patterns) {
        for (const row of pattern) expect(row).toHaveLength(module.channels);
      }
      // Notes that decode to something outside MIDI's range mean the note base
      // or the packing is wrong.
      for (const pattern of module.patterns) {
        for (const row of pattern) {
          for (const cell of row) {
            if (typeof cell.note === 'number') {
              expect(cell.note).toBeGreaterThanOrEqual(0);
              expect(cell.note).toBeLessThanOrEqual(127);
            }
          }
        }
      }
    });
  }
});
```

- [ ] **Step 3: Run it**

Run: `bun run test -- src/shared/tracker/acceptance.test.ts`
Expected: PASS for both files. The DSM should report 4 channels, 24 patterns and 31 order entries.

- [ ] **Step 4: Check the whole import path end to end**

```bash
cat > src/shared/tracker/__check.test.ts <<'EOF'
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { trackerToScore, validateScore } from '@sudobility/music_lib';
import { SharedTrackerCodec } from '../mod/codec.js';

it('turns the real DSM into a valid score', () => {
  const path = new URL('./fixtures/race_against_time.dsm', import.meta.url).pathname;
  const buf = readFileSync(path);
  const module = new SharedTrackerCodec().decode(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const score = trackerToScore(module);
  const issues = validateScore(score);
  // eslint-disable-next-line no-console
  console.log(`tracks=${score.tracks.length} measures=${score.tracks[0]?.measures.length} issues=${issues.length}`);
  expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  expect(issues.filter((i) => i.code === 'measure-underfull')).toEqual([]);
});
EOF
rsync -a --delete ../music_lib/dist/ node_modules/@sudobility/music_lib/dist/
npx vitest run src/shared/tracker/__check.test.ts --silent=false --disable-console-intercept
rm src/shared/tracker/__check.test.ts
```

Expected: `issues=0`, and a plausible track count. **The `rsync` matters** — `music_io`'s copy of `music_lib` is what this test resolves, and it goes stale silently.

- [ ] **Step 5: Verify and propagate**

```bash
bun run verify
bun run clean && bun run build
for c in music_lib music_app; do rsync -a --delete dist/ ../$c/node_modules/@sudobility/music_io/dist/; done
rm -rf ../music_app/node_modules/.vite
```

- [ ] **Step 6: Confirm the note base against a reference player**

This is the one value the code cannot check itself. Open `race_against_time.dsm` in OpenMPT, read the note name in the first cell of pattern 1 channel 1, and compare against what the reader produces for that cell.

The measured file's first pattern in playback order begins with note byte 46 on channel 0. At `NOTE_BASE = 11` that is MIDI 57, A3.

If OpenMPT disagrees, adjust `NOTE_BASE` by the difference, update its doc comment to say it is now confirmed and against what, and re-run the acceptance test. **Do not skip this step** — an octave error is invisible to every automated check here, since all the notes move together.

- [ ] **Step 7: Accept `.dsm` in the app**

In `music_app/src/features/projects/DashboardPage.tsx`, widen the file input:

```tsx
accept = '.mod,.dsm,audio/mod,application/octet-stream';
```

and change the dialog copy so it no longer says ProTracker specifically. Grep for "ProTracker" and "tracker module" in that file and in `src/components/dialogs/` to find every string.

- [ ] **Step 8: Update the docs**

`music_io/CLAUDE.md`: DSM lives in `src/shared/tracker/`; every offset was measured against a real file rather than a specification, and two contradict the commonly cited layout — `numOrders` at +36 and the `INST` name at +36; DSM shares ProTracker's effect lettering, which is why `protracker-effects.ts` is shared with MOD.

`music_app/CLAUDE.md`: the module import gotcha now covers `.mod` and `.dsm`.

- [ ] **Step 9: Deploy**

```bash
cd /Users/johnhuang/projects/music_app && ./scripts/push_all.sh
```

If a downstream repo fails typecheck on a symbol that exists in the source it was just built against, that is the npm publish race the script's own comments describe: poll `npm view @sudobility/<pkg> version`, `bun update` it, and resume with `--starting-project <name>`.

- [ ] **Step 10: Report back**

Say what the real DSM imported as (tracks, measures, issues), whether OpenMPT confirmed the note base or moved it, and anything the plan's measured offsets got wrong. The next plan is S3M — the first format with packed rows that are genuinely unlike MOD's.

---

## Self-Review Notes

**Spec coverage:** §2's DSM row → Tasks 1, 3, 4. Magic-byte detection → Task 5. §7's real-file fixtures → Task 6. §1 and §3 are untouched **by design**: if DSM had needed the model or the mapping changed, the model was wrong, and that is the thing this plan is really testing.

**Deliberately out of scope:** S3M, XM, IT and MPTM; moving MOD into `src/shared/tracker/`; renaming the `modCodec` service property. Each is noted where it would otherwise look like an oversight.

**The known unknown:** `NOTE_BASE`. The real file fixes note _spacing_ but not the absolute base, because it contains no reference pitch and no note-off. Task 6 Step 6 is a manual check against OpenMPT, and it is called out as unskippable because an octave error moves every note together and so passes every automated test in this plan.

**Type consistency, checked:** `readRiffChunks` returns `start` as the payload offset in Task 1 and is consumed that way in Task 3. `applyProTrackerEffect(cell, effect, param)` has the same three parameters in Tasks 2 and 4. `readDsm(buffer: ArrayBuffer)` matches its call in Task 5. `buildDsm`'s options match its uses in Tasks 3, 4 and 5.

**Verified against a real file, not assumed:** the RIFF length excludes its own 8-byte header; `SONG` is 192 bytes with `numOrders` at +36; `INST` is a 64-byte header with the name at +36 and `64 + length` equal to the chunk length; `PATT` opens with a uint16 self-length and unpacks to exactly 64 rows consuming exactly the chunk; effect `0x0F` splits at `0x20` exactly as ProTracker does.
