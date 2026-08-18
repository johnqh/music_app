# IT Decoder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read Impulse Tracker (`.it`) and OpenMPT (`.mptm`) modules into the neutral `TrackerModule`, completing the five-format tracker import set.

**Architecture:** One reader, `src/shared/tracker/it.ts`, following the shape of `s3m.ts` and `xm.ts`. IT is offset-table-addressed like S3M, so nothing is read by walking forward. Its pattern encoding is a **stateful channel-mask run-length** scheme — the one genuinely new mechanism in this format, and the one place a structurally-correct reader can silently lose a third of the notes. MPTM is not a separate format: it is IT with `cmwt == 0x0888`, so it shares the entire reader and differs only in the `format` field it reports. Effect commands reuse `applyS3mEffect` unchanged, because IT numbers its commands 1=A…26=Z exactly as S3M does.

**Tech Stack:** TypeScript (strict), vitest, `@sudobility/music_types` for the neutral model. No new dependencies.

## Global Constraints

- The reader lives in `music_io`, in `src/shared/` — nothing about parsing bytes is platform-bound, so web and React Native share one implementation.
- **`music_lib` is not modified by this plan.** `flattenRows` and `trackerToScore` already handle everything IT produces (verified — see Finding 6).
- **`music_types` is not modified by this plan.** `TrackerFormat` already includes `'it'` and `'mptm'`.
- Sample data is never read. Only the offset tables are followed, and only to reach names.
- The volume column is read for byte-accounting and discarded, as in every other reader.
- Effect handling is `applyS3mEffect`, imported unchanged. Do not write an `it-effects.ts`.
- Every hand-built fixture must be able to produce the _awkward_ shapes, not just the easy ones. A builder that can only emit the simple case will agree with a reader that can only read it.

---

## Format facts, verified against seven real files

Everything below was measured before this plan was written, by unpacking seven
real modules. **All seven unpack to exactly their declared row counts, consuming
exactly their declared byte counts**, under the rules stated here.

Two of them ship as fixtures — the two with verified provenance, chosen because
between them they cover every rule in this document:

| Fixture                    | Format | modarchive | Size |
| -------------------------- | ------ | ---------- | ---- |
| `c512w_-_thereal1.it`      | IT     | 214787     | 225K |
| `asikwp_-_preparator.mptm` | MPTM   | 189288     | 85K  |

Header layout, all little-endian:

| Offset         | Size         | Field                                    |
| -------------- | ------------ | ---------------------------------------- |
| 0              | 4            | `IMPM` magic                             |
| 4              | 26           | Song name                                |
| 32             | 2            | `OrdNum` — order list length             |
| 34             | 2            | `InsNum`                                 |
| 36             | 2            | `SmpNum`                                 |
| 38             | 2            | `PatNum`                                 |
| 40             | 2            | `Cwtv` — created with tracker version    |
| 42             | 2            | `Cmwt` — compatible with tracker version |
| 44             | 2            | `Flags`                                  |
| 48             | 1            | Global volume                            |
| 50             | 1            | Initial speed                            |
| 51             | 1            | Initial tempo (BPM)                      |
| 192            | `OrdNum`     | Order list, one byte per entry           |
| 192 + `OrdNum` | 4 × `InsNum` | Instrument offsets (uint32)              |
| …              | 4 × `SmpNum` | Sample offsets (uint32)                  |
| …              | 4 × `PatNum` | Pattern offsets (uint32)                 |

Measured values across the corpus (shipped fixtures in bold):

| File                  | Size | cmwt       | Patterns | Instruments   | Channels used | Row counts                 |
| --------------------- | ---- | ---------- | -------- | ------------- | ------------- | -------------------------- |
| **`thereal1.it`**     | 225K | 0x0214     | 18       | 11 (11 named) | 24            | {64}                       |
| **`preparator.mptm`** | 85K  | **0x0888** | 26       | 18 (13 named) | 8             | {8, 56, 63, 64, 65, 72}    |
| `sadsong.it`          | 39K  | 0x0214     | 12       | 12            | 15            | {128}                      |
| `24.it`               | 703K | 0x0214     | 23       | 22            | 32            | {4, 32, 128}               |
| `djb.it`              | 1.0M | 0x0200     | 37       | 19            | 46            | {24, 52, 64, 90, 120, 212} |
| `2001.mptm`           | 384K | **0x0888** | 23       | 25            | 5             | {24, 52, 64, 90, 120, 212} |
| `child.mptm`          | 4.9M | **0x0888** | 3        | 12            | 13            | {12, 308, 417}             |

### Finding 1: the pattern encoding is stateful, and this is the whole difficulty

Each pattern begins with a header: `uint16 length` at +0, `uint16 rows` at +2,
four reserved bytes, packed data from +8.

The packed stream is a sequence of **channel variable** bytes:

- `cv == 0` ends the current row.
- Otherwise the channel is `(cv - 1) & 63`.
- If `cv & 128`, a **new mask byte follows**, and it must be remembered as this
  channel's mask. Otherwise **reuse the mask this channel last used** — no byte
  is consumed.

The mask byte has two halves, and this is the part that matters:

| Bit | Value | Meaning                                        | Bytes consumed |
| --- | ----- | ---------------------------------------------- | -------------- |
| 0   | 1     | Read note                                      | 1              |
| 1   | 2     | Read instrument                                | 1              |
| 2   | 4     | Read volume                                    | 1              |
| 3   | 8     | Read command + param                           | 2              |
| 4   | 16    | **Replay this channel's last note**            | 0              |
| 5   | 32    | **Replay this channel's last instrument**      | 0              |
| 6   | 64    | **Replay this channel's last volume**          | 0              |
| 7   | 128   | **Replay this channel's last command + param** | 0              |

**The replay bits consume no bytes, so a reader that ignores them still unpacks
every pattern byte-perfectly and still lands on the exact declared row count.**
Every structural check passes. It just silently loses notes. Measured:

| File                  | Notes read | Notes **replayed** | Instruments read | Instruments **replayed** |
| --------------------- | ---------- | ------------------ | ---------------- | ------------------------ |
| **`thereal1.it`**     | 4,782      | **1,246** (21%)    | 271              | **4,798** (17.7:1)       |
| **`preparator.mptm`** | 2,690      | **492** (15%)      | 471              | **1,929** (4.1:1)        |
| `sadsong.it`          | 4,568      | 1,124              | 456              | 4,870                    |
| `24.it`               | 5,261      | 3,065              | 514              | 7,751                    |
| `djb.it`              | 16,991     | **8,058** (32%)    | 2,882            | 15,380                   |
| `2001.mptm`           | 454        | 534                | 489              | 496                      |
| `child.mptm`          | 131        | 0                  | 20               | 94                       |

In `djb.it`, 8,058 of 25,049 notes — **32%** — exist only as replay bits; in the
shipped `thereal1.it` it is 21%. And replayed instruments outnumber read
instruments **17.7 to 1** in that same shipped file, so without the instrument
half nearly every note lands on instrument 0 and is grouped onto one wrong
track.

Two independent per-channel memories are therefore required: the last **mask**,
and the last **value** of each of the four fields.

### Finding 2: mask reuse is the common case, not the rare one

`cv & 128` clear — reuse the remembered mask — happens more often than a new
mask byte in five of seven files (`sadsong.it`: 4,249 reuses against 3,016 new;
the shipped `thereal1.it`: 3,088 against 3,985).
A reader that assumes a mask byte always follows desynchronises immediately.

### Finding 3: row counts vary wildly, well past IT's documented maximum

`{4, 8, 12, 24, 32, 52, 56, 63, 64, 65, 72, 90, 120, 128, 212, 308, 417}` across
the corpus. `child.mptm` has a **417-row pattern**. Nothing may assume 64 rows,
and nothing may assume a 200-row ceiling. The row count comes from the pattern
header, per pattern, always.

The shipped `preparator.mptm` covers this with six distinct lengths — 8, 56, 63,
64, 65 and 72 — including the two that sit either side of 64, which is where an
off-by-one in the row loop would hide. `thereal1.it` is uniformly 64 rows, so it
does _not_ cover this; the two fixtures are complementary rather than redundant.

A pattern offset of 0 means an empty pattern. It does not occur anywhere in this
corpus, but IT permits it, and the reader must produce 64 empty rows rather than
crash or emit zero rows — the same rule `xm.ts` applies to `packedSize == 0`.

### Finding 4: the note base is 0, and this is not the family convention

Note bytes are 0–119 for real notes, `255` for note-off, `254` for note cut.

**`midi = note` — there is no offset.** IT note 60 is middle C and MIDI 60 is
middle C. IT _displays_ middle C as "C-5" where scientific pitch notation calls
it C4, but that is an octave-_naming_ difference, not a pitch one.

This deliberately breaks the pattern set by the other readers, where XM and DSM
both use `NOTE_BASE = 11` and S3M uses 12. Reasoning by that convention gives
`note + 12` and is **wrong**, on three independent pieces of evidence:

1. **It exceeds MIDI.** `preparator.mptm` uses note 119. With `+12` that is MIDI
   131, outside the 0–127 range the acceptance test already asserts. With no
   offset it is 119, valid. IT's full 0–119 range only fits MIDI at base 0.
2. **The drums land on the GM kick.** Both shipped fixtures are drum-heavy
   (`thereal1.it` names `bm (kick)`, `ch (hi-hat)`, `(clap)`;
   `preparator.mptm` names `Kick-013`, `Snare Drum`, `High Hat`). The lowest
   note in each is 37 and 36 respectively — landing on MIDI 36, the General
   MIDI bass drum, exactly. At `+12` the kick would sit at 48.
3. **The registers are plausible.** 37–85 and 36–119 at base 0; 49–97 and
   48–131 at `+12`.

`255` appears in six of seven files and `254` in three, including both shipped
fixtures (915 offs / 44 cuts and 739 / 7). Both map to `'off'` in the neutral
model, so a real file exercises each.

### Finding 5: MPTM is `cmwt == 0x0888`, and `OMPT` is a decoy

The three MPTM files report `cmwt == 0x0888`; the four IT files report 0x0214,
0x0214, 0x0214 and 0x0200. That is the discriminator.

**Do not use the `OMPT` marker in the reserved field at offset 60.**
`sadsong.it` carries it — it means "written by OpenMPT", not "is an MPTM". A
reader keying on it labels an ordinary IT file as MPTM.

MPTM appends its extensions after the IT data. This reader never reads past the
offset tables it follows, so the extensions are ignored for free.

### Finding 6: the order list carries markers, already handled downstream

`255` means end-of-song and `254` means "skip this entry". The shipped
`thereal1.it` carries **both**: four `254` separators mid-list and a `255` as its
final entry. `2001.mptm` uses `254` eight times. `24.it` additionally contains an
entry (23) past its last pattern index (0–22) — a genuinely invalid entry in the
file.

`flattenRows` in `music_lib` already does `const pattern = module.patterns[patternIndex]; if (!pattern) continue;`,
so every one of these is skipped harmlessly. **No `music_lib` change is needed.**
The reader truncates the order at the first `255` because that is what the byte
means, and everything else is pushed raw, as `s3m.ts` does.

In this corpus `255` is always the final entry, so truncating and skipping are
indistinguishable here — the rule is taken from the format, and costs nothing.

### Finding 7: instrument names only, with no sample-name fallback

All seven files set the "use instruments" flag (`Flags & 4`), so the pattern
instrument column always indexes instruments. Instrument headers carry `IMPI`
magic with a 26-byte name at +32; sample headers carry `IMPS` with a name at
+20.

Name coverage is inconsistent, and the fallback is a trap:

| File                  | Named instruments | Named samples                     |
| --------------------- | ----------------- | --------------------------------- |
| **`thereal1.it`**     | 11/11             | —                                 |
| **`preparator.mptm`** | 13/18             | —                                 |
| `sadsong.it`          | 5/12              | 9/14 — all literally `"untitled"` |
| `24.it`               | 1/22              | 0/22                              |
| `djb.it`              | 19/19             | 0/20                              |
| `2001.mptm`           | 0/25              | 0/24                              |
| `child.mptm`          | 9/12              | 14/14                             |

Falling back to the sample name when the instrument name is empty would help
`child.mptm` and would fill `sadsong.it`'s tracks with `"untitled"`. Read
instrument names only. An empty name is fine: `trackerToScore` already names
unnamed tracks, and this matches `s3m.ts` and `xm.ts`.

The samples-as-instruments path (`Flags & 4` clear) is **not exercised by this
corpus** and is therefore not implemented. The instrument column is read as an
instrument index unconditionally, exactly as in the other readers.

---

## File Structure

- **Create** `music_io/src/shared/tracker/it-fixture.ts` — hand-built IT builder. Must be able to emit: a chosen `cmwt`, per-pattern row counts, replay-bit cells, mask-reuse cells, and empty patterns.
- **Create** `music_io/src/shared/tracker/it.ts` — `readIt(buffer): TrackerModule`.
- **Create** `music_io/src/shared/tracker/it.test.ts` — byte-level tests against the builder.
- **Modify** `music_io/src/shared/mod/codec.ts` — detect `IMPM` at offset 0.
- **Modify** `music_io/src/shared/tracker/acceptance.test.ts` — add an `IT real-world findings` block.
- **Add** `music_io/src/shared/tracker/fixtures/thereal1.it` (225K) and `preparator.mptm` (85K).
- **Modify** `music_io/src/shared/tracker/fixtures/README.md` — provenance rows and why each file earns its place.
- **Modify** `music_app/src/features/projects/DashboardPage.tsx:676` — `accept` list and description copy.

---

### Task 1: The fixture builder

**Files:**

- Create: `music_io/src/shared/tracker/it-fixture.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `buildIt(opts?: ItOptions): ArrayBuffer`, plus the exported types `ItCellSpec`, `ItPatternSpec`, `ItOptions`. Task 2 and Task 3 build every test input with it.

The builder must be able to emit the shapes Finding 1–3 identified. Chiefly:
`replay` on a cell (emit mask bits 16/32/64/128 and no value bytes) and
`reuseMask` on a cell (emit the channel byte with bit 7 clear, and no mask
byte). Without those two, Task 3's tests cannot fail for the right reason.

- [ ] **Step 1: Write the builder**

```ts
/**
 * A hand-built IT file, for testing the reader against known bytes.
 *
 * Deliberately able to produce the shapes that make IT hard: a cell that
 * *replays* a channel's remembered value without consuming bytes, a cell that
 * reuses the channel's remembered *mask* without one, per-pattern row counts,
 * and an empty pattern. A builder that could only emit fully-specified cells
 * would agree with a reader that ignored the replay bits entirely — which is
 * exactly the bug this format invites.
 */

export type ItCellSpec = {
  /** 0-119 real note, 255 note off, 254 note cut. */
  note?: number;
  instrument?: number;
  volume?: number;
  command?: number;
  param?: number;
  /** Emit replay bits (16/32/64/128) for these fields; no bytes are written. */
  replay?: Array<'note' | 'instrument' | 'volume' | 'command'>;
  /** Emit the channel byte with bit 7 clear, reusing the channel's last mask. */
  reuseMask?: boolean;
};

export type ItPatternSpec = {
  rows: number;
  /** `cells[row][channel]`; missing entries emit nothing for that channel. */
  cells?: ItCellSpec[][];
  /** Write offset 0 for this pattern — an empty pattern. */
  empty?: boolean;
};

export type ItOptions = {
  title?: string;
  /** 0x0888 makes it an MPTM; anything else is an IT. */
  cmwt?: number;
  order?: number[];
  patterns?: ItPatternSpec[];
  instruments?: string[];
  samples?: string[];
  speed?: number;
  tempo?: number;
};

const ORDERS_AT = 192;

function ascii(out: Uint8Array, at: number, text: string, length: number): void {
  for (let i = 0; i < length; i += 1) out[at + i] = i < text.length ? text.charCodeAt(i) : 0;
}

function packPattern(spec: ItPatternSpec): Uint8Array {
  const body: number[] = [];
  for (let row = 0; row < spec.rows; row += 1) {
    const cells = spec.cells?.[row] ?? [];
    for (let ch = 0; ch < cells.length; ch += 1) {
      const cell = cells[ch];
      if (!cell) continue;
      const channelByte = (ch + 1) & 63;
      if (cell.reuseMask) {
        // Bit 7 clear: the reader must reuse this channel's remembered mask.
        body.push(channelByte);
      } else {
        let mask = 0;
        if (cell.note !== undefined) mask |= 1;
        if (cell.instrument !== undefined) mask |= 2;
        if (cell.volume !== undefined) mask |= 4;
        if (cell.command !== undefined) mask |= 8;
        for (const field of cell.replay ?? []) {
          if (field === 'note') mask |= 16;
          if (field === 'instrument') mask |= 32;
          if (field === 'volume') mask |= 64;
          if (field === 'command') mask |= 128;
        }
        body.push(channelByte | 128, mask);
      }
      // Value bytes follow in field order, and only for the read bits.
      if (cell.note !== undefined) body.push(cell.note);
      if (cell.instrument !== undefined) body.push(cell.instrument);
      if (cell.volume !== undefined) body.push(cell.volume);
      if (cell.command !== undefined) body.push(cell.command, cell.param ?? 0);
    }
    body.push(0); // end of row
  }
  return new Uint8Array(body);
}

export function buildIt(opts: ItOptions = {}): ArrayBuffer {
  const order = opts.order ?? [0];
  const patterns = opts.patterns ?? [{ rows: 64 }];
  const instruments = opts.instruments ?? ['Lead'];
  const samples = opts.samples ?? [];

  const packed = patterns.map((p) => (p.empty ? null : packPattern(p)));

  const headerSize =
    ORDERS_AT + order.length + (instruments.length + samples.length + patterns.length) * 4;
  const INSTRUMENT_BYTES = 64;
  const SAMPLE_BYTES = 48;
  const instrumentTotal = instruments.length * INSTRUMENT_BYTES;
  const sampleTotal = samples.length * SAMPLE_BYTES;
  const patternTotal = packed.reduce((n, p) => n + (p ? p.length + 8 : 0), 0);

  const out = new Uint8Array(headerSize + instrumentTotal + sampleTotal + patternTotal);
  const view = new DataView(out.buffer);

  ascii(out, 0, 'IMPM', 4);
  ascii(out, 4, opts.title ?? 'Fixture', 26);
  view.setUint16(32, order.length, true);
  view.setUint16(34, instruments.length, true);
  view.setUint16(36, samples.length, true);
  view.setUint16(38, patterns.length, true);
  view.setUint16(40, 0x0214, true); // Cwtv
  view.setUint16(42, opts.cmwt ?? 0x0214, true);
  view.setUint16(44, 0x0d, true); // Flags: stereo + use instruments
  out[50] = opts.speed ?? 6;
  out[51] = opts.tempo ?? 125;
  order.forEach((value, i) => {
    out[ORDERS_AT + i] = value;
  });

  const insTableAt = ORDERS_AT + order.length;
  const smpTableAt = insTableAt + instruments.length * 4;
  const patTableAt = smpTableAt + samples.length * 4;

  let at = headerSize;
  instruments.forEach((name, i) => {
    view.setUint32(insTableAt + i * 4, at, true);
    ascii(out, at, 'IMPI', 4);
    ascii(out, at + 32, name, 26);
    at += INSTRUMENT_BYTES;
  });
  samples.forEach((name, i) => {
    view.setUint32(smpTableAt + i * 4, at, true);
    ascii(out, at, 'IMPS', 4);
    ascii(out, at + 20, name, 26);
    at += SAMPLE_BYTES;
  });
  packed.forEach((data, i) => {
    if (!data) {
      view.setUint32(patTableAt + i * 4, 0, true); // an empty pattern
      return;
    }
    view.setUint32(patTableAt + i * 4, at, true);
    view.setUint16(at, data.length, true);
    view.setUint16(at + 2, patterns[i].rows, true);
    out.set(data, at + 8);
    at += data.length + 8;
  });

  return out.buffer;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd music_io && bunx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd music_io
git add src/shared/tracker/it-fixture.ts
git commit -m "test: hand-built IT fixture builder"
```

---

### Task 2: Header, order list and instrument names

**Files:**

- Create: `music_io/src/shared/tracker/it.ts`
- Create: `music_io/src/shared/tracker/it.test.ts`

**Interfaces:**

- Consumes: `buildIt` from Task 1.
- Produces: `readIt(buffer: ArrayBuffer): TrackerModule`. Task 3 fills in its pattern unpacking; Task 4 imports it in `codec.ts` and the acceptance tests.

This task builds the reader with patterns stubbed to empty rows, so the header
arithmetic is proven before the hard part lands on top of it.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildIt } from './it-fixture.js';
import { readIt } from './it.js';

describe('readIt', () => {
  it('rejects a file without the IMPM magic', () => {
    const bytes = new Uint8Array(256);
    expect(() => readIt(bytes.buffer)).toThrow(/Not an Impulse Tracker module/);
  });

  it('reads the title', () => {
    expect(readIt(buildIt({ title: 'Sad Song' })).title).toBe('Sad Song');
  });

  it('reads instrument names from the IMPI header, not the sample header', () => {
    // Both tables are populated with different names on purpose: reading the
    // wrong table would still return plausible strings.
    const module = readIt(
      buildIt({ instruments: ['hihat', 'ride'], samples: ['untitled', 'untitled'] }),
    );
    expect(module.instruments.map((i) => i.name)).toEqual(['hihat', 'ride']);
  });

  it('numbers instruments from one', () => {
    const module = readIt(buildIt({ instruments: ['a', 'b'] }));
    expect(module.instruments.map((i) => i.index)).toEqual([1, 2]);
  });

  it('truncates the order list at the end-of-song marker', () => {
    const module = readIt(buildIt({ order: [0, 1, 255, 0], patterns: [{ rows: 4 }, { rows: 4 }] }));
    expect(module.order).toEqual([0, 1]);
  });

  it('keeps the skip marker, which flattenRows drops as an unknown pattern', () => {
    // 254 is a separator. It is not a pattern index and not an end marker.
    const module = readIt(buildIt({ order: [0, 254, 1], patterns: [{ rows: 4 }, { rows: 4 }] }));
    expect(module.order).toEqual([0, 254, 1]);
  });

  it('reports mptm only for cmwt 0x0888', () => {
    expect(readIt(buildIt({ cmwt: 0x0214 })).format).toBe('it');
    expect(readIt(buildIt({ cmwt: 0x0200 })).format).toBe('it');
    expect(readIt(buildIt({ cmwt: 0x0888 })).format).toBe('mptm');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd music_io && bunx vitest run src/shared/tracker/it.test.ts`
Expected: FAIL — `Failed to resolve import "./it.js"`.

- [ ] **Step 3: Write the reader**

```ts
/**
 * Reading an Impulse Tracker module into the neutral tracker model.
 *
 * Addressed by offset tables, like S3M: the header carries a uint32 offset per
 * instrument, sample and pattern, so nothing is found by walking forward.
 *
 * **Measured against seven real modules** (four IT, three MPTM), all of which
 * unpack to exactly their declared row counts consuming exactly their declared
 * bytes. The one thing that does *not* show up in those numbers is the replay
 * half of the mask — see `unpackPattern`, where 32% of one file's notes live.
 *
 * MPTM is not a separate format. OpenMPT writes the same structure and marks it
 * with `cmwt == 0x0888`; its extensions are appended after the data this reader
 * follows, so they are ignored for free.
 *
 * Sample data is never read.
 */
import type { TrackerCell, TrackerInstrument, TrackerModule } from '@sudobility/music_types';
import { applyS3mEffect } from './s3m-effects.js';

const ORDERS_AT = 192;
const HEADER_MINIMUM = ORDERS_AT;

const INSTRUMENT_NAME_AT = 32;
const NAME_LENGTH = 26;

/** OpenMPT's marker. `OMPT` at offset 60 means "written by", not "is one". */
const MPTM_CMWT = 0x0888;

/**
 * IT note 60 *is* MIDI 60 — no offset. IT displays middle C as "C-5" where
 * scientific notation calls it C4, but that is a naming difference, not a
 * pitch one. Deliberately unlike XM/DSM (11) and S3M (12): IT's full 0-119
 * range only fits MIDI at base 0, and `preparator.mptm` uses note 119.
 */
const NOTE_BASE = 0;
const NOTE_OFF = 255;
const NOTE_CUT = 254;

/** Order list markers. 255 ends the song; 254 separates and is not a pattern. */
const ORDER_END = 255;

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const c = bytes[at + i];
    if (c === 0) break;
    if (c >= 32 && c < 127) out += String.fromCharCode(c);
  }
  return out.trim();
}

function fourCC(bytes: Uint8Array, at: number): string {
  if (at + 4 > bytes.length) return '';
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

export function readIt(buffer: ArrayBuffer): TrackerModule {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < HEADER_MINIMUM) {
    throw new Error('Not an Impulse Tracker module: file is too short');
  }
  if (fourCC(bytes, 0) !== 'IMPM') {
    throw new Error(`Not an Impulse Tracker module: signature is "${fourCC(bytes, 0)}"`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ordNum = view.getUint16(32, true);
  const insNum = view.getUint16(34, true);
  const smpNum = view.getUint16(36, true);
  const patNum = view.getUint16(38, true);
  const cmwt = view.getUint16(42, true);

  // 255 ends the song, so nothing past it is played. 254 is a separator and is
  // left in place: it is not a valid pattern index, and `flattenRows` skips it.
  const order: number[] = [];
  for (let i = 0; i < ordNum; i += 1) {
    const entry = bytes[ORDERS_AT + i];
    if (entry === ORDER_END) break;
    order.push(entry);
  }

  const insTableAt = ORDERS_AT + ordNum;
  const patTableAt = insTableAt + insNum * 4 + smpNum * 4;

  const instruments: TrackerInstrument[] = [];
  for (let i = 0; i < insNum; i += 1) {
    const at = view.getUint32(insTableAt + i * 4, true);
    // Sample names are deliberately not a fallback: where they are populated
    // they are as often "untitled" as anything useful.
    const usable = at !== 0 && at + INSTRUMENT_NAME_AT + NAME_LENGTH <= bytes.length;
    instruments.push({
      index: i + 1,
      name: usable ? ascii(bytes, at + INSTRUMENT_NAME_AT, NAME_LENGTH) : '',
    });
  }

  const patterns: TrackerCell[][][] = [];
  let channels = 1;
  for (let p = 0; p < patNum; p += 1) {
    const at = view.getUint32(patTableAt + p * 4, true);
    const unpacked = unpackPattern(bytes, view, at);
    channels = Math.max(channels, unpacked.channels);
    patterns.push(unpacked.rows);
  }

  return {
    format: cmwt === MPTM_CMWT ? 'mptm' : 'it',
    title: ascii(bytes, 4, NAME_LENGTH),
    channels,
    instruments,
    order,
    patterns,
  };
}
```

Stub the unpacker for now — Task 3 replaces it:

```ts
function unpackPattern(
  bytes: Uint8Array,
  view: DataView,
  at: number,
): { rows: TrackerCell[][]; channels: number } {
  return { rows: [], channels: 1 };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd music_io && bunx vitest run src/shared/tracker/it.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd music_io
git add src/shared/tracker/it.ts src/shared/tracker/it.test.ts
git commit -m "feat: read the IT header, order list and instrument names"
```

---

### Task 3: Pattern unpacking — the replay bits

**Files:**

- Modify: `music_io/src/shared/tracker/it.ts`
- Modify: `music_io/src/shared/tracker/it.test.ts`

**Interfaces:**

- Consumes: `buildIt`, `readIt` from Tasks 1–2.
- Produces: nothing new — fills in `unpackPattern`.

This is the task the format exists to make hard. Read Finding 1 before starting.
The two per-channel memories are independent: the last **mask** (for `cv & 128`
clear) and the last **value** of each field (for mask bits 16/32/64/128).

- [ ] **Step 1: Write the failing tests**

```ts
describe('IT pattern unpacking', () => {
  const cell = (module: ReturnType<typeof readIt>, row: number, ch: number) =>
    module.patterns[0][row][ch];

  it('gives each pattern the row count from its own header', () => {
    const module = readIt(buildIt({ patterns: [{ rows: 128 }, { rows: 417 }], order: [0, 1] }));
    expect(module.patterns[0]).toHaveLength(128);
    expect(module.patterns[1]).toHaveLength(417);
  });

  it('gives an empty pattern 64 blank rows rather than none', () => {
    const module = readIt(buildIt({ patterns: [{ rows: 64, empty: true }] }));
    expect(module.patterns[0]).toHaveLength(64);
    expect(module.patterns[0][0].every((c) => c.note === null)).toBe(true);
  });

  it('reads a fully specified cell', () => {
    const module = readIt(
      buildIt({ patterns: [{ rows: 2, cells: [[{ note: 48, instrument: 3, volume: 64 }]] }] }),
    );
    expect(cell(module, 0, 0).note).toBe(48);
    expect(cell(module, 0, 0).instrument).toBe(3);
  });

  it('maps note 60 to MIDI 60 and note 119 into range', () => {
    // IT's "C-5" is middle C. Adding an octave, as XM and DSM's bases would
    // suggest, puts note 119 at MIDI 131 — and preparator.mptm uses note 119.
    const module = readIt(
      buildIt({ patterns: [{ rows: 2, cells: [[{ note: 60 }], [{ note: 119 }]] }] }),
    );
    expect(cell(module, 0, 0).note).toBe(60);
    expect(cell(module, 1, 0).note).toBe(119);
  });

  it('maps both note-off and note-cut to off', () => {
    const module = readIt(
      buildIt({ patterns: [{ rows: 2, cells: [[{ note: 255 }], [{ note: 254 }]] }] }),
    );
    expect(cell(module, 0, 0).note).toBe('off');
    expect(cell(module, 1, 0).note).toBe('off');
  });

  // The heart of the format. Without the replay half, this test's second row
  // comes back empty while every structural assertion still passes.
  it('replays a channel remembered note and instrument, consuming no bytes', () => {
    const module = readIt(
      buildIt({
        patterns: [
          {
            rows: 3,
            cells: [
              [{ note: 60, instrument: 7 }],
              [{ replay: ['note', 'instrument'] }],
              [{ note: 62 }],
            ],
          },
        ],
      }),
    );
    expect(cell(module, 1, 0).note).toBe(60);
    expect(cell(module, 1, 0).instrument).toBe(7);
    // The stream must still be aligned afterwards.
    expect(cell(module, 2, 0).note).toBe(62);
  });

  it('remembers per channel, not globally', () => {
    const module = readIt(
      buildIt({
        patterns: [
          {
            rows: 2,
            cells: [
              [
                { note: 60, instrument: 1 },
                { note: 40, instrument: 2 },
              ],
              [{ replay: ['note', 'instrument'] }, { replay: ['note', 'instrument'] }],
            ],
          },
        ],
      }),
    );
    expect(cell(module, 1, 0).note).toBe(60);
    expect(cell(module, 1, 0).instrument).toBe(1);
    expect(cell(module, 1, 1).note).toBe(40);
    expect(cell(module, 1, 1).instrument).toBe(2);
  });

  it('reuses the remembered mask when the channel byte has bit 7 clear', () => {
    const module = readIt(
      buildIt({
        patterns: [
          {
            rows: 2,
            cells: [[{ note: 50, instrument: 4 }], [{ note: 52, instrument: 5, reuseMask: true }]],
          },
        ],
      }),
    );
    // Row 1 wrote no mask byte; the reader must reuse "note + instrument".
    expect(cell(module, 1, 0).note).toBe(52);
    expect(cell(module, 1, 0).instrument).toBe(5);
  });

  it('applies IT commands with S3M numbering', () => {
    // 1 = A = speed, 20 = T = tempo. ProTracker numbering would read these as
    // something else entirely, so checking both knobs pins the choice.
    const module = readIt(
      buildIt({
        patterns: [{ rows: 2, cells: [[{ command: 1, param: 3 }], [{ command: 20, param: 140 }]] }],
      }),
    );
    expect(cell(module, 0, 0).speed).toBe(3);
    expect(cell(module, 1, 0).bpm).toBe(140);
  });

  it('sizes rows to the widest channel any pattern reaches', () => {
    const module = readIt(
      buildIt({
        patterns: [{ rows: 1, cells: [[{ note: 60 }, undefined, undefined, { note: 62 }]] }],
      }),
    );
    expect(module.channels).toBe(4);
    for (const row of module.patterns[0]) expect(row).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd music_io && bunx vitest run src/shared/tracker/it.test.ts`
Expected: FAIL — the stub returns no rows, so every assertion on `patterns[0][row]` throws.

- [ ] **Step 3: Replace the stub**

```ts
/** IT's own default when a pattern carries no data. */
const EMPTY_PATTERN_ROWS = 64;
const MAX_CHANNELS = 64;

const emptyCell = (): TrackerCell => ({ instrument: 0, note: null });

/**
 * One packed pattern.
 *
 * The stream is channel-variable bytes. `0` ends a row. Otherwise the channel
 * is `(cv - 1) & 63`, and bit 7 says whether a **mask byte follows** or the
 * channel's *remembered* mask applies.
 *
 * The mask has two halves. Bits 1/2/4/8 read note, instrument, volume and
 * command+param from the stream. Bits 16/32/64/128 **replay this channel's last
 * value for that field and consume nothing** — which is why a reader that drops
 * them still consumes every declared byte and still lands on the exact declared
 * row count, while silently losing notes. Measured on `djb.it`: 8,058 of 25,049
 * notes exist only as replay bits, and replayed instruments outnumber read ones
 * roughly ten to one, so those notes would also group onto the wrong track.
 */
function unpackPattern(
  bytes: Uint8Array,
  view: DataView,
  at: number,
): { rows: TrackerCell[][]; channels: number } {
  // Offset 0 means an empty pattern: blank rows, not zero rows.
  if (at === 0 || at + 8 > bytes.length) {
    return {
      rows: Array.from({ length: EMPTY_PATTERN_ROWS }, () => [emptyCell()]),
      channels: 1,
    };
  }

  const length = view.getUint16(at, true);
  const numRows = view.getUint16(at + 2, true);
  const start = at + 8;
  const end = Math.min(start + length, bytes.length);

  const rows: TrackerCell[][] = Array.from({ length: numRows }, () => []);
  let widest = 0;

  const lastMask = new Uint8Array(MAX_CHANNELS);
  const lastNote = new Uint8Array(MAX_CHANNELS);
  const lastInstrument = new Uint8Array(MAX_CHANNELS);
  const lastVolume = new Uint8Array(MAX_CHANNELS);
  const lastCommand = new Uint8Array(MAX_CHANNELS);
  const lastParam = new Uint8Array(MAX_CHANNELS);

  let pos = start;
  let row = 0;
  while (pos < end && row < numRows) {
    const cv = bytes[pos];
    pos += 1;
    if (cv === 0) {
      row += 1;
      continue;
    }

    const channel = (cv - 1) & 63;
    let mask: number;
    if (cv & 128) {
      mask = bytes[pos];
      pos += 1;
      lastMask[channel] = mask;
    } else {
      mask = lastMask[channel];
    }

    // The read half. Each consumes bytes and updates the channel's memory.
    if (mask & 1) {
      lastNote[channel] = bytes[pos];
      pos += 1;
    }
    if (mask & 2) {
      lastInstrument[channel] = bytes[pos];
      pos += 1;
    }
    if (mask & 4) {
      // Volume is read for byte accounting and discarded, as everywhere else.
      lastVolume[channel] = bytes[pos];
      pos += 1;
    }
    if (mask & 8) {
      lastCommand[channel] = bytes[pos];
      lastParam[channel] = bytes[pos + 1];
      pos += 2;
    }

    // The replay half consumes nothing; it only selects what to emit.
    const hasNote = (mask & 1) !== 0 || (mask & 16) !== 0;
    const hasInstrument = (mask & 2) !== 0 || (mask & 32) !== 0;
    const hasCommand = (mask & 8) !== 0 || (mask & 128) !== 0;

    while (rows[row].length <= channel) rows[row].push(emptyCell());
    widest = Math.max(widest, channel + 1);
    const cell = rows[row][channel];

    if (hasNote) {
      const raw = lastNote[channel];
      if (raw === NOTE_OFF || raw === NOTE_CUT) cell.note = 'off';
      else cell.note = raw + NOTE_BASE;
    }
    if (hasInstrument) cell.instrument = lastInstrument[channel];
    if (hasCommand) applyS3mEffect(cell, lastCommand[channel], lastParam[channel]);
  }

  return { rows, channels: Math.max(widest, 1) };
}
```

`readIt` must then pad every row out to the module-wide channel count, since
patterns are unpacked before the widest channel is known. Add this immediately
before the `return` in `readIt`:

```ts
for (const pattern of patterns) {
  for (const row of pattern) {
    while (row.length < channels) row.push({ instrument: 0, note: null });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd music_io && bunx vitest run src/shared/tracker/it.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Verify by sabotage**

The replay bits are the whole point of this task, and the failure they cause is
silent. Prove the test catches it:

```bash
cd music_io
# Delete the replay half of the note rule.
# Change:  const hasNote = (mask & 1) !== 0 || (mask & 16) !== 0;
# To:      const hasNote = (mask & 1) !== 0;
bunx vitest run src/shared/tracker/it.test.ts
```

Expected: `replays a channel remembered note and instrument` FAILS.
Then restore the line and confirm the suite is green again.

- [ ] **Step 6: Commit**

```bash
cd music_io
git add src/shared/tracker/it.ts src/shared/tracker/it.test.ts
git commit -m "feat: unpack IT patterns, including the replay mask bits"
```

---

### Task 4: Format detection, real files and shipping

**Files:**

- Modify: `music_io/src/shared/mod/codec.ts`
- Modify: `music_io/src/shared/tracker/acceptance.test.ts`
- Modify: `music_io/src/shared/tracker/fixtures/README.md`
- Add: `music_io/src/shared/tracker/fixtures/thereal1.it`, `music_io/src/shared/tracker/fixtures/preparator.mptm`
- Modify: `music_app/src/features/projects/DashboardPage.tsx:676`

**Interfaces:**

- Consumes: `readIt` from Tasks 2–3.
- Produces: `.it` and `.mptm` reaching `readIt` through `getAppServices().io.modCodec`.

- [ ] **Step 1: Add detection to the codec**

In `src/shared/mod/codec.ts`, import the reader and add the branch. `IMPM` sits
at offset 0, so it goes with the other magic checks, above the MOD fallback:

```ts
import { readIt } from '../tracker/it.js';
```

```ts
if (fourCC(view, 0) === 'IMPM') return readIt(bytes);
```

- [ ] **Step 2: Download the fixtures**

```bash
cd music_io/src/shared/tracker/fixtures
curl -L -o thereal1.it   'https://api.modarchive.org/downloads.php?moduleid=214787'
curl -L -o preparator.mptm 'https://api.modarchive.org/downloads.php?moduleid=189288'
ls -l thereal1.it preparator.mptm
md5 thereal1.it preparator.mptm
```

Verify against the exact files this plan was measured on:

| File              | Bytes  | md5                                |
| ----------------- | ------ | ---------------------------------- |
| `thereal1.it`     | 230663 | `141c93754b990af2bd3acea50e0ead1f` |
| `preparator.mptm` | 87116  | `2dbf861aebef38da7c894b34f752fb8e` |

Every numeric assertion in Step 3 is taken from these two files. A different
download means different counts, and the tests will fail on the numbers rather
than on the logic.

Both must begin with `IMPM`. If a download returns HTML instead, the file will
be a few KB and will not — check before continuing:

```bash
head -c 4 thereal1.it; echo; head -c 4 preparator.mptm; echo
```

- [ ] **Step 3: Write the acceptance tests**

Append to `src/shared/tracker/acceptance.test.ts`, and add
`import { readIt } from './it.js';` at the top. The generic `real modules`
block already picks up both new files automatically, since it reads the whole
directory.

```ts
describe('IT real-world findings', () => {
  const load = (name: string) => {
    const buf = readFileSync(`${DIR}${name}`);
    return readIt(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  };
  const notesOf = (name: string) =>
    load(name)
      .patterns.flat(2)
      .map((c) => c.note)
      .filter((n): n is number => typeof n === 'number');

  it('recognises MPTM by cmwt alone', () => {
    expect(load('thereal1.it').format).toBe('it');
    expect(load('preparator.mptm').format).toBe('mptm');
  });

  it('keeps note 119 inside MIDI, which a twelve-semitone base would not', () => {
    // preparator.mptm reaches note 119. At `note + 12` that is MIDI 131.
    const notes = notesOf('preparator.mptm');
    expect(Math.max(...notes)).toBe(119);
    expect(Math.min(...notes)).toBe(36);
  });

  it('puts the lowest drum note on the General MIDI kick', () => {
    // Both files are drum kits — thereal1.it names "bm (kick)", preparator
    // "Kick-013". MIDI 36 is the GM bass drum; an octave up would be 48.
    expect(Math.min(...notesOf('thereal1.it'))).toBe(37);
    expect(Math.min(...notesOf('preparator.mptm'))).toBe(36);
  });

  it('reads the replayed notes, which a structurally-correct reader would lose', () => {
    // thereal1.it holds 4,782 notes behind read bits and 1,246 behind replay
    // bits. Dropping the replay half still unpacks every byte cleanly and still
    // lands on every declared row — it just returns 21% fewer notes.
    expect(notesOf('thereal1.it').length).toBeGreaterThan(5500);
  });

  it('assigns almost every note an instrument, which comes mostly from replay', () => {
    // 271 instruments are read and 4,798 replayed — 17.7 to 1. Without the
    // replay half nearly every note lands on instrument 0 and groups onto one
    // wrong track.
    const cells = load('thereal1.it')
      .patterns.flat(2)
      .filter((c) => typeof c.note === 'number');
    const placed = cells.filter((c) => c.instrument > 0);
    expect(placed.length / cells.length).toBeGreaterThan(0.9);
  });

  it('gives each pattern its own row count', () => {
    // preparator.mptm has six distinct lengths, including 63 and 65 either side
    // of 64 — where an off-by-one in the row loop would hide.
    const rows = new Set(load('preparator.mptm').patterns.map((p) => p.length));
    expect(rows).toEqual(new Set([8, 56, 63, 64, 65, 72]));
  });

  it('stops the order list at the end marker and keeps the skip marker', () => {
    // thereal1.it carries both: four 254 separators, and 255 as its last entry.
    const order = load('thereal1.it').order;
    expect(order).not.toContain(255);
    expect(order.filter((o) => o === 254)).toHaveLength(4);
  });

  it('finds both note-off and note-cut, mapped alike', () => {
    const offs = (name: string) =>
      load(name)
        .patterns.flat(2)
        .filter((c) => c.note === 'off');
    // 915 offs + 44 cuts, and 739 + 7.
    expect(offs('thereal1.it')).toHaveLength(959);
    expect(offs('preparator.mptm')).toHaveLength(746);
  });

  it('reads every instrument name', () => {
    expect(load('thereal1.it').instruments.filter((i) => i.name.length > 0)).toHaveLength(11);
    expect(load('preparator.mptm').instruments.filter((i) => i.name.length > 0)).toHaveLength(13);
  });
});
```

- [ ] **Step 4: Run the full tracker suite**

Run: `cd music_io && bunx vitest run src/shared/tracker/`
Expected: PASS, including the generic `real modules` block over all nine files.

- [ ] **Step 5: Record provenance**

Add to the table in `fixtures/README.md`:

```markdown
| `thereal1.it` | IT | The "REAL" One | c512w | 214787 |
| `preparator.mptm` | MPTM | Preparator | asikwp | 189288 |
```

And add this paragraph after the XM one:

```markdown
**The IT pair pins the two things that format gets wrong quietly, and they are
complementary rather than redundant.** `thereal1.it` is the replay-bit
regression test: 1,246 of its notes (21%) and 4,798 of its instrument
assignments exist only as mask bits 16 and 32, which consume no bytes — so a
reader that ignores them unpacks every pattern to exactly its declared length,
passes every structural check, and still loses a fifth of the music onto the
wrong tracks. It is also the only file here carrying both order-list markers:
four 254 separators mid-list and a trailing 255. `preparator.mptm` covers what
it does not. It is the MPTM, declaring `cmwt == 0x0888`; it has six distinct
pattern lengths including 63 and 65 either side of 64, where an off-by-one in
the row loop would hide; and it reaches **note 119**, which is what pins the
note base at 0. At `note + 12` — the base XM and DSM would suggest — that note
decodes to MIDI 131 and fails the range check outright.

Both are drum kits, which corroborates the base independently: their lowest
notes are 37 and 36, landing on the General MIDI bass drum rather than an
octave above it.
```

- [ ] **Step 6: Accept the extensions in the app**

In `music_app/src/features/projects/DashboardPage.tsx:676`:

```tsx
accept = '.mod,.dsm,.s3m,.xm,.it,.mptm,audio/mod,application/octet-stream';
```

And the description on the same component:

```tsx
description =
  'Opens a tracker module (.MOD, .DSM, .S3M, .XM, .IT, .MPTM) as a new project. Notes are grouped by instrument rather than by channel, and the order list is flattened, so a pattern played three times becomes three sets of measures.';
```

- [ ] **Step 7: Verify both repos**

Run: `cd music_io && bun run verify`
Expected: PASS.

Then propagate the built `music_io` into `music_app` and verify there. Note
CLAUDE.md's rule: `bun run build` does not clean `dist`, and `node_modules/.vite`
must be deleted after an rsync.

```bash
cd music_io && bun run clean && bun run build
rsync -a --delete dist/ ../music_app/node_modules/@sudobility/music_io/dist/
rm -rf ../music_app/node_modules/.vite
cd ../music_app && bun run verify
```

Expected: PASS.

- [ ] **Step 8: Manual check**

Start `bun run dev`, import `thereal1.it` from the dashboard, and confirm the
project opens with eleven named tracks (`c512w: bap`, `c512w: bm (kick)`,
`c512w: ch (hi-hat)`, …) and **zero validation issues**. Then import
`preparator.mptm` and confirm it opens with named tracks (`Kick-013`,
`Snare Drum`, `High Hat`, …).

Both are drum kits, so the register is checkable by eye: the kick should sit at
the bottom of the bass staff, not an octave above it.

- [ ] **Step 9: Commit and push**

Per the standing instruction, use the shared script rather than committing by
hand:

```bash
cd music_app && ./scripts/push_all.sh
```

---

## Self-Review Notes

**Spec coverage.** The design spec asked for `.IT` and `.MPTM` alongside the
existing three. Both are covered: one reader, MPTM discriminated by `cmwt`,
detection wired in `codec.ts`, extensions accepted in the app.

**Deliberate omissions**, each with a reason rather than an oversight:

- **Samples-as-instruments** (`Flags & 4` clear). Not implemented. All seven
  measured files set the flag; the path is unreachable in this corpus, and
  implementing it untested would be speculation.
- **Sample-name fallback for empty instrument names.** Rejected on evidence —
  it would fill `sadsong.it`'s tracks with `"untitled"` (Finding 7).
- **Empty patterns (offset 0) have no real fixture.** They occur in none of the
  seven files. The rule is taken from the format and covered by the hand-built
  test, mirroring what `xm.ts` already does for `packedSize == 0`.
- **`music_lib` untouched.** Verified rather than assumed: `flattenRows`
  already guards `if (!pattern) continue`, which absorbs the 254 marker and
  `24.it`'s out-of-range entry (Finding 6).

**On the note base.** An earlier draft of this plan set `NOTE_BASE = 12` by
analogy with XM and DSM. That was wrong, and the corpus disproves it three ways
(Finding 4) — most conclusively `preparator.mptm`'s note 119, which only fits
MIDI at base 0. Unlike DSM's base, this one is **not** an open question; it is
pinned by two acceptance tests. Do not "restore consistency" with the other
readers here.

**Type consistency.** `readIt` matches the `readS3m`/`readXm`/`readDsm`
signature — `(buffer: ArrayBuffer) => TrackerModule`. `unpackPattern` returns
`{ rows, channels }`, differing from `s3m.ts`'s `RawEvent[][]` because IT
patterns carry their own row count and can be materialised immediately, where
S3M's cannot be sized until every pattern has been scanned.

**The one risk worth restating.** Task 3 is the only place this format can fail
silently. Every structural assertion — row counts, byte consumption, row widths,
MIDI range — passes on a reader that ignores mask bits 16/32/64/128. Step 5's
sabotage check is not optional.
