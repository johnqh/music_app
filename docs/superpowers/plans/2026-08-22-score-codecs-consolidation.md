# Score Codecs Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every score (note-carrying) file format out of `music_io` into `music_codecs`, leaving `music_io` with audio (sample-carrying) formats and true platform capabilities only.

**Architecture:** `music_codecs` gains the byte layer it was missing — a hand-written Standard MIDI File codec and the five tracker-module readers moved verbatim from `music_io`. The `MidiCodec`/`TrackerCodec` injection seam is deleted rather than relocated: `music_codecs` exports plain functions, and `MusicIo` loses two fields. `@tonejs/midi` stays a `music_codecs` devDependency used only as a test oracle, so the package keeps `dependencies: []`.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Bun, Prettier (music_codecs only), ESLint.

**Spec:** `docs/superpowers/specs/2026-08-22-score-codecs-consolidation-design.md`

## Global Constraints

- **`music_codecs` must keep `dependencies: []` and exactly one peer dependency, `@sudobility/music_types`.** `src/__architecture.test.ts` asserts both; do not weaken it.
- **`@tonejs/midi` may appear only under `music_codecs/src/test/` and in `*.test.ts` files.** It stays on the architecture guard's `FORBIDDEN` list for `src/`. It is a devDependency, never a dependency or peer.
- **`music_codecs` enforces Prettier** (`bun run format:check` runs inside `bun run verify`). Config: `semi: true`, `singleQuote: true`, `printWidth: 80`, `tabWidth: 2`, `trailingComma: "es5"`, `arrowParens: "avoid"`. **`music_io` has no Prettier config at all**, so every moved file must be reformatted — see Task 2.
- **`music_codecs` targets ES2020** (the server consumes it). No `.at()`, no `Object.hasOwn`, no `Array.prototype.findLast`.
- **Never auto-commit or auto-push.** The project's git policy (`music_app/CLAUDE.md`) forbids it. Commit steps in this plan are written out, but run them only when the user asks in that turn.
- **Value ranges in the neutral model:** `MidiNote.velocity` and `MidiControlChange.value` are **normalized 0–1**, not 0–127. `MidiTempoEvent.bpm` is a float. `MidiFile.duration` and `MidiTrackData.durationSeconds` are seconds.
- **Cross-repo builds:** after building a `@sudobility/*` package for local consumption, run `bun run clean && bun run build`, `rsync` into the consumer's `node_modules`, and delete the consumer's `node_modules/.vite`. A `bun add`/`bun remove` in `music_app` reinstalls from the registry and silently discards rsynced packages.
- **Publish order** (from `music_app/scripts/push_all.sh`): `music_types` → `music_codecs` → `music_drawing` → `music_api` → `music_client` → `music_io` → `music_lib` → `music_app`.

---

## File Structure

**`music_types`**

- Create `src/formats/` — `midi.ts`, `mod.ts` (moved from `src/platform/`), `index.ts`. These are score-format _model_ types with no platform binding; a folder named `platform` holding them is the mislabeling this whole change fixes.
- Modify `src/platform/index.ts` (drop two re-exports), `src/index.ts` (add one), `src/platform/platform.test.ts`.
- Delete the `MidiCodec` and `TrackerCodec` **interfaces** only. Every model type stays.

**`music_codecs`**

- Create `src/tracker/` — the byte readers moved from `music_io`: `read.ts` (MOD), `period.ts`, `dsm.ts`, `it.ts`, `s3m.ts`, `xm.ts`, `xm-write.ts`, `riff.ts`, `protracker-effects.ts`, `s3m-effects.ts`, `dispatch.ts` (new — was `mod/codec.ts`), and the five `*-fixture.ts` builders, each with its `*.test.ts`.
- Create `src/midi/bytes.ts` — `ByteReader`/`ByteWriter`, the SMF primitives (VLQ, big-endian ints, ASCII). One responsibility: turning bytes into numbers and back.
- Create `src/midi/decode.ts` — `decodeMidi`. Create `src/midi/encode.ts` — `encodeMidi`. Split because decoding and encoding share only `bytes.ts` and change for different reasons.
- Create `src/midi/errors.ts` — `MidiParseError`.
- Modify `src/midi/import.ts`, `export.ts`, `analyze.ts` (drop the `codec` parameter), `src/index.ts`, `src/__architecture.test.ts`, `src/mod/types.ts`.
- Rename `src/test/platform.ts` → `src/test/xml.ts` (it becomes XML-only once the MIDI hand-copy is deleted).

**`music_io`** — deletions only: `src/shared/mod/`, `src/shared/tracker/`, `src/shared/midi/codec.tonejs.ts(.test.ts)`. Modify `src/shared/types.ts`, `src/web/index.ts`, `src/rn/index.ts`, `src/mocks/index.ts`, `src/contract/platform-contract.ts`, `package.json`, `CLAUDE.md`.

**`music_lib`** — `src/test/platform.ts` (delete the MIDI half), `src/services/perf/benchmark.ts` + its test, `package.json`.

**`music_api`** — delete `src/services/transcription/midi-codec.ts`; modify `settle.ts`, `package.json`.

**`music_app`** — five production call sites, four test call sites, `src/test/app-services.ts`.

---

### Task 1: music_types — retire the two codec interfaces, rehome the format models

**Repo:** `~/projects/music_types`

**Files:**

- Create: `src/formats/index.ts`
- Move: `src/platform/midi.ts` → `src/formats/midi.ts`
- Move: `src/platform/mod.ts` → `src/formats/mod.ts`
- Modify: `src/platform/index.ts`, `src/index.ts:43`, `src/platform/platform.test.ts` (only if it names the moved files — it does not today, and Step 7's grep confirms)

**Interfaces:**

- Consumes: nothing (first task).
- Produces: `MidiFile`, `MidiNote`, `MidiTrackData`, `MidiControlChange`, `MidiTempoEvent`, `MidiTimeSignatureEvent`, `TrackerModule`, `TrackerCell`, `TrackerFormat`, `TrackerInstrument` — all still exported from the package root, unchanged in shape. `MidiCodec` and `TrackerCodec` no longer exist.

- [ ] **Step 1: Move the two files**

```bash
cd ~/projects/music_types
mkdir -p src/formats
git mv src/platform/midi.ts src/formats/midi.ts
git mv src/platform/mod.ts   src/formats/mod.ts
```

- [ ] **Step 2: Delete the `MidiCodec` interface**

Remove these five lines from the end of `src/formats/midi.ts`:

```ts
export interface MidiCodec {
  decode(data: ArrayBuffer): MidiFile;
  encode(file: MidiFile): Uint8Array;
}
```

- [ ] **Step 3: Delete the `TrackerCodec` interface**

Remove the whole doc comment and interface at the end of `src/formats/mod.ts`, from `/**` above `Reading a tracker module.` through the closing `}` of `export interface TrackerCodec`. `TrackerModule` and everything above it stays.

- [ ] **Step 4: Create the barrel**

`src/formats/index.ts`:

```ts
/**
 * Score file-format models: the neutral shapes a MIDI file and a tracker
 * module decode into.
 *
 * Not under `platform/`, deliberately. These carry notes rather than samples,
 * so nothing about them is platform-bound — the codecs that produce them live
 * in `@sudobility/music_codecs` and run identically on web, React Native and
 * the server.
 */
export * from './midi.js';
export * from './mod.js';
```

- [ ] **Step 5: Drop the two re-exports from the platform barrel**

In `src/platform/index.ts`, delete the lines `export * from "./midi.js";` and `export * from "./mod.js";`. Leave `midi-input.js` — live MIDI input is a device capability and stays platform.

- [ ] **Step 6: Add the new barrel to the package index**

In `src/index.ts`, beside line 43's `export * from "./platform/index.js";`, add:

```ts
export * from './formats/index.js';
```

- [ ] **Step 7: Verify — the package builds and nothing references the dead interfaces**

```bash
cd ~/projects/music_types
grep -rn "MidiCodec\|TrackerCodec" src/ || echo "clean"
bun run verify
```

Expected: `clean`, then typecheck/lint/test/build all pass. Consumers import from the package root, so no consumer path changes.

- [ ] **Step 8: Commit** (only if the user has asked for a commit this turn)

```bash
git add -A && git commit -m "refactor: move MIDI/tracker format models out of platform, drop codec interfaces"
```

---

### Task 2: music_codecs — move the tracker byte readers (pure move)

**Repo:** `~/projects/music_codecs`

This is a **pure move**: these 28 files import only `@sudobility/music_types` and each other. If a moved test needs any edit beyond an import path or Prettier formatting, stop — the move was not clean and something else is going on.

**Files:**

- Create `src/tracker/` containing, from `music_io/src/shared/mod/`: `read.ts`, `read.test.ts`, `period.ts`, `period.test.ts`, `fixture.ts`; and from `music_io/src/shared/tracker/`: `dsm.ts`, `dsm.test.ts`, `dsm-fixture.ts`, `it.ts`, `it.test.ts`, `it-fixture.ts`, `s3m.ts`, `s3m.test.ts`, `s3m-fixture.ts`, `s3m-effects.ts`, `s3m-effects.test.ts`, `xm.ts`, `xm.test.ts`, `xm-fixture.ts`, `xm-write.ts`, `xm-write.test.ts`, `riff.ts`, `riff.test.ts`, `protracker-effects.ts`, `protracker-effects.test.ts`, `acceptance.test.ts`
- Create `src/tracker/dispatch.ts` (from `music_io/src/shared/mod/codec.ts`) and `src/tracker/dispatch.test.ts` (from `codec.test.ts`)
- Modify: `src/mod/types.ts` (a stale comment)

**Interfaces:**

- Consumes: Task 1's `TrackerModule`, `TrackerFormat`, `TrackerCell`, `TrackerInstrument` from `@sudobility/music_types`.
- Produces:
  - `decodeTracker(bytes: ArrayBuffer): TrackerModule`
  - `encodeTracker(module: TrackerModule): ArrayBuffer`
  - and, for tests within the package: `readMod`, `readDsm`, `readIt`, `readS3m`, `readXm`, `encodeXm`, `periodToMidi`, `readRiffChunks`, `RiffChunk`, `applyProTrackerEffect`, `applyS3mEffect`, `buildMod`, `buildDsm`, `buildIt`, `buildS3m`, `buildXm`

- [ ] **Step 1: Copy the files across**

```bash
cd ~/projects/music_codecs
mkdir -p src/tracker
cp ~/projects/music_io/src/shared/mod/read.ts        src/tracker/
cp ~/projects/music_io/src/shared/mod/read.test.ts   src/tracker/
cp ~/projects/music_io/src/shared/mod/period.ts      src/tracker/
cp ~/projects/music_io/src/shared/mod/period.test.ts src/tracker/
cp ~/projects/music_io/src/shared/mod/fixture.ts     src/tracker/
cp ~/projects/music_io/src/shared/mod/codec.ts       src/tracker/dispatch.ts
cp ~/projects/music_io/src/shared/mod/codec.test.ts  src/tracker/dispatch.test.ts
cp ~/projects/music_io/src/shared/tracker/*.ts       src/tracker/
cp -R ~/projects/music_io/src/shared/tracker/fixtures src/tracker/fixtures
ls src/tracker | wc -l   # expect 28 .ts files plus fixtures/
```

`fixtures/` is a **binary corpus** — eight real tracker modules (780KB: `1995.mod`,
`thereal1.it`, `preparator.mptm`, two `.s3m`, two `.xm`, one `.dsm`) that
`acceptance.test.ts` reads off disk. A `*.ts` glob silently misses it and the
acceptance suite then fails with `ENOENT` rather than with anything that names
the real problem.

- [ ] **Step 2: Fix the cross-folder import paths**

`dispatch.ts` was `mod/codec.ts` and reached siblings via `../tracker/`; `acceptance.test.ts` did the same. Everything is now one folder:

```bash
cd ~/projects/music_codecs
sed -i '' "s#from '\.\./tracker/#from './#g" src/tracker/*.ts
sed -i '' "s#from '\.\./mod/codec\.js'#from './dispatch.js'#g" src/tracker/*.ts
sed -i '' "s#from '\./codec\.js'#from './dispatch.js'#g" src/tracker/*.ts
grep -rn "\.\./" src/tracker/*.ts || echo "no parent-relative imports left"
```

Expected: `no parent-relative imports left`.

- [ ] **Step 3: Convert the class to two functions**

`dispatch.ts` arrived as `export class SharedTrackerCodec implements TrackerCodec`. That interface no longer exists. Replace the class with the two functions, keeping **every comment and the magic-byte ordering verbatim** — the ordering is load-bearing (MOD's magic sits at offset 1080 and `readMod` validates it, which is why it is the fallback rather than something sniffed twice):

```ts
/**
 * Chooses a reader by magic bytes, never by file extension.
 *
 * A mis-named module still imports, and an unrecognised file fails saying
 * what was actually at the front of it rather than "parse error".
 */
export function decodeTracker(bytes: ArrayBuffer): TrackerModule {
  const view = new Uint8Array(bytes);
  if (fourCC(view, 0) === 'RIFF' && fourCC(view, 8) === 'DSMF') return readDsm(bytes);
  // IT and MPTM share this magic and this reader; they differ only in `cmwt`.
  if (fourCC(view, 0) === 'IMPM') return readIt(bytes);
  if (fourCC(view, 44) === 'SCRM') return readS3m(bytes);
  // 17 characters including the trailing space, so not a fourCC.
  if (asciiAt(view, 0, 17) === 'Extended Module: ') return readXm(bytes);
  // MOD's magic sits at 1080, past the header, and `readMod` validates it —
  // so it is the fallback rather than something sniffed twice.
  return readMod(bytes);
}

/**
 * Writes a module out in the format it names.
 *
 * Only the formats export supports are written; DSM and MPTM are import-only
 * by design, and throwing names the format rather than silently writing a
 * near neighbour the user did not ask for.
 */
export function encodeTracker(module: TrackerModule): ArrayBuffer {
  if (module.format === 'xm') return encodeXm(module);
  throw new Error(`Writing "${module.format}" is not supported yet`);
}
```

Keep the private `asciiAt` and `fourCC` helpers exactly as they are. Update the file's top doc comment: it currently says "The `TrackerCodec` capability, for all three platforms" — it is now simply the format dispatcher.

- [ ] **Step 4: Update `dispatch.test.ts` to call the functions**

```bash
cd ~/projects/music_codecs
sed -i '' "s#new SharedTrackerCodec()\.decode#decodeTracker#g; s#new SharedTrackerCodec()\.encode#encodeTracker#g" src/tracker/dispatch.test.ts
```

Then replace any remaining `const codec = new SharedTrackerCodec()` / `codec.decode(` / `codec.encode(` with direct `decodeTracker(` / `encodeTracker(` calls, and fix the import line to `import { decodeTracker, encodeTracker } from './dispatch.js';`.

- [ ] **Step 5: Run the moved tests — they must pass unmodified**

```bash
cd ~/projects/music_codecs
bun run test -- src/tracker
```

Expected: every suite passes (129 tests).

One test needs a real edit, and it is the destination's environment rather than
the move: `music_codecs` sets `environment: 'jsdom'` in `vitest.config.ts` (for
two MusicXML suites that want `DOMParser`), while `music_io` has no config and
defaults to node. Under jsdom `import.meta.url` is an `http://` URL, so
`acceptance.test.ts`'s `new URL('./fixtures/', import.meta.url).pathname`
resolves to `/src/tracker/fixtures` — the filesystem root. Add a leading
docblock to that file:

```ts
/**
 * @vitest-environment node
 *
 * Node, not this package's jsdom default: this suite reads real module files
 * off disk, and under jsdom `import.meta.url` is an `http://` URL whose
 * `pathname` resolves `./fixtures/` to `/src/tracker/fixtures`, at the
 * filesystem root. jsdom is here for two MusicXML suites that want `DOMParser`
 * and nothing else needs it.
 */
```

Beyond that one file: if a test fails on anything other than an import path,
**stop and report** — a clean move cannot change behaviour.

- [ ] **Step 6: Apply Prettier**

`music_io` has no Prettier config; `music_codecs` enforces one in `verify`. This is the one formatting-only diff the move is allowed to produce.

```bash
cd ~/projects/music_codecs
bun run format
bun run test -- src/tracker   # re-run: formatting must not change behaviour
```

- [ ] **Step 7: Fix the stale comment in `src/mod/types.ts`**

Line 2 reads ``The shape `music_io`'s `TrackerCodec.decode` produces.`` Replace with:

```ts
/**
 * The shape `decodeTracker` in `../tracker/dispatch.js` produces.
 */
```

- [ ] **Step 8: Verify the whole package**

```bash
cd ~/projects/music_codecs
bun run verify
```

Expected: format:check, typecheck, lint, test, build all pass. `__architecture.test.ts` still passes — nothing moved in imports `music_io`, `music_lib`, `vexflow`, `tone` or `@tonejs/midi`.

- [ ] **Step 9: Commit** (only if asked)

```bash
git add -A && git commit -m "feat: move tracker byte readers from music_io into music_codecs"
```

---

### Task 3: music_codecs — SMF byte primitives

**Repo:** `~/projects/music_codecs`

**Files:**

- Create: `src/midi/errors.ts`, `src/midi/bytes.ts`
- Test: `src/midi/bytes.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `MidiParseError`; `ByteReader` with `position`, `remaining`, `seek(n)`, `skip(n)`, `uint8()`, `uint16()`, `uint32()`, `bytes(n): Uint8Array`, `ascii(n): string`, `varint(): number`; `ByteWriter` with `uint8(v)`, `uint16(v)`, `uint32(v)`, `bytes(vs)`, `ascii(s)`, `varint(v)`, `toUint8Array()`.

- [ ] **Step 1: Write the failing test**

`src/midi/bytes.test.ts`. The variable-length-quantity vectors are the canonical table from the SMF 1.0 specification — the format's classic failure point, so they are pinned exactly:

```ts
import { describe, expect, it } from 'vitest';
import { ByteReader, ByteWriter } from './bytes.js';
import { MidiParseError } from './errors.js';

/** The SMF 1.0 specification's own variable-length-quantity table. */
const VLQ: ReadonlyArray<[number, number[]]> = [
  [0x00000000, [0x00]],
  [0x00000040, [0x40]],
  [0x0000007f, [0x7f]],
  [0x00000080, [0x81, 0x00]],
  [0x00002000, [0xc0, 0x00]],
  [0x00003fff, [0xff, 0x7f]],
  [0x00004000, [0x81, 0x80, 0x00]],
  [0x00100000, [0xc0, 0x80, 0x00]],
  [0x001fffff, [0xff, 0xff, 0x7f]],
  [0x00200000, [0x81, 0x80, 0x80, 0x00]],
  [0x08000000, [0xc0, 0x80, 0x80, 0x00]],
  [0x0fffffff, [0xff, 0xff, 0xff, 0x7f]],
];

function readerOf(bytes: number[]): ByteReader {
  return new ByteReader(Uint8Array.from(bytes).buffer);
}

describe('varint', () => {
  it.each(VLQ)('writes %i', (value, expected) => {
    const writer = new ByteWriter();
    writer.varint(value);
    expect([...writer.toUint8Array()]).toEqual(expected);
  });

  it.each(VLQ)('reads back %i', (value, encoded) => {
    expect(readerOf(encoded).varint()).toBe(value);
  });

  it('refuses a quantity longer than four bytes', () => {
    expect(() => readerOf([0xff, 0xff, 0xff, 0xff, 0x7f]).varint()).toThrow(MidiParseError);
  });
});

describe('big-endian primitives', () => {
  it('round-trips uint16 and uint32', () => {
    const writer = new ByteWriter();
    writer.uint16(0x1234);
    writer.uint32(0xdeadbeef);
    const reader = new ByteReader(writer.toUint8Array().buffer);
    expect(reader.uint16()).toBe(0x1234);
    expect(reader.uint32()).toBe(0xdeadbeef);
  });

  it('round-trips ascii', () => {
    const writer = new ByteWriter();
    writer.ascii('MThd');
    expect(new ByteReader(writer.toUint8Array().buffer).ascii(4)).toBe('MThd');
  });

  it('reports the offset when the buffer ends mid-value', () => {
    expect(() => readerOf([0x01]).uint32()).toThrow(/ended mid-value at byte 0/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd ~/projects/music_codecs && bun run test -- src/midi/bytes.test.ts
```

Expected: FAIL — `Failed to resolve import "./bytes.js"`.

- [ ] **Step 3: Write `src/midi/errors.ts`**

```ts
/**
 * A file that is not a Standard MIDI File, or is one and is malformed.
 *
 * Its own class rather than a bare `Error` for the same reason `XmlParseError`
 * is: an import dialog has to tell "this is not a MIDI file" apart from "this
 * codec has a bug", and a message match is not a test anybody can rely on.
 */
export class MidiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MidiParseError';
  }
}
```

- [ ] **Step 4: Write `src/midi/bytes.ts`**

```ts
import { MidiParseError } from './errors.js';

/** The largest value a four-byte variable-length quantity can hold. */
const MAX_VARINT = 0x0fffffff;

/** Reads big-endian primitives and variable-length quantities off a buffer. */
export class ByteReader {
  private offset = 0;
  private readonly view: DataView;
  private readonly data: Uint8Array;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.data = new Uint8Array(buffer);
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  seek(to: number): void {
    this.offset = to;
  }

  skip(count: number): void {
    this.offset += count;
  }

  private require(count: number): void {
    if (this.offset + count > this.data.length) {
      throw new MidiParseError(`The file ended mid-value at byte ${this.offset}.`);
    }
  }

  uint8(): number {
    this.require(1);
    const value = this.data[this.offset];
    this.offset += 1;
    return value;
  }

  uint16(): number {
    this.require(2);
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  uint32(): number {
    this.require(4);
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  bytes(length: number): Uint8Array {
    this.require(length);
    const out = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  ascii(length: number): string {
    let out = '';
    for (const byte of this.bytes(length)) out += String.fromCharCode(byte);
    return out;
  }

  /**
   * Seven bits per byte, high bit set on every byte but the last.
   *
   * Accumulates with `* 128` rather than `<< 7`: the maximum is 28 bits, and
   * bit-shifting a value that wide in JavaScript is a sign-extension bug
   * waiting for the one file that reaches it.
   */
  varint(): number {
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const byte = this.uint8();
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new MidiParseError('A variable-length quantity ran past four bytes.');
  }
}

/** Builds a byte string with the same primitives `ByteReader` consumes. */
export class ByteWriter {
  private readonly out: number[] = [];

  get length(): number {
    return this.out.length;
  }

  uint8(value: number): void {
    this.out.push(value & 0xff);
  }

  uint16(value: number): void {
    this.uint8(value >>> 8);
    this.uint8(value);
  }

  uint32(value: number): void {
    this.uint8(value >>> 24);
    this.uint8(value >>> 16);
    this.uint8(value >>> 8);
    this.uint8(value);
  }

  bytes(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i += 1) this.uint8(values[i]);
  }

  ascii(text: string): void {
    for (let i = 0; i < text.length; i += 1) this.uint8(text.charCodeAt(i));
  }

  varint(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > MAX_VARINT) {
      throw new MidiParseError(`${value} is not a writable variable-length quantity.`);
    }
    const chunks = [value & 0x7f];
    let rest = Math.floor(value / 128);
    while (rest > 0) {
      chunks.push((rest & 0x7f) | 0x80);
      rest = Math.floor(rest / 128);
    }
    for (let i = chunks.length - 1; i >= 0; i -= 1) this.out.push(chunks[i]);
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd ~/projects/music_codecs && bun run test -- src/midi/bytes.test.ts && bun run format && bun run typecheck
```

Expected: PASS, 28 cases (12 varint writes, 12 varint reads, and 4 guards/primitives).

- [ ] **Step 6: Commit** (only if asked)

```bash
git add src/midi/bytes.ts src/midi/bytes.test.ts src/midi/errors.ts
git commit -m "feat: add SMF byte primitives to music_codecs"
```

---

### Task 4: music_codecs — `decodeMidi`

**Repo:** `~/projects/music_codecs`

**Files:**

- Create: `src/midi/decode.ts`
- Test: `src/midi/decode.test.ts`

**Interfaces:**

- Consumes: Task 3's `ByteReader`, `MidiParseError`; `gmInstrument` and the `Midi*` model types from `@sudobility/music_types`.
- Produces: `decodeMidi(data: ArrayBuffer): MidiFile`.

**Behaviour contract** — pin these, they are the parts that are wrong by default:

1. A note-on at **velocity 0 is a note-off**. Writers emit it constantly; taken literally the note sounds forever.
2. **Running status**: a byte below `0x80` where a status is expected reuses the previous channel status and is itself the first data byte. `0xFF`/`0xF0`/`0xF7` clear it.
3. `velocity` and control-change `value` are **normalized to 0–1**.
4. A **format-1 leading chunk with no channel events is the conductor**: it yields no `MidiTrackData`, and its track-name meta becomes `header.name`. (Stricter than `@tonejs/midi`'s "duration is 0", which misfires on a real track that carries only controllers.)
5. **Format 0 splits by channel** — see Task 6, which is where that is tested against the old behaviour.
6. A note left open when the track ends is closed at the track's end tick rather than dropped.

- [ ] **Step 1: Write the failing test**

`src/midi/decode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeMidi } from './decode.js';
import { MidiParseError } from './errors.js';

/** Wraps event bytes as a single-track file at 480 ppq. */
function fileOf(format: number, tracks: number[][]): ArrayBuffer {
  const out: number[] = [];
  const push32 = (v: number) =>
    out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  out.push(0x4d, 0x54, 0x68, 0x64);
  push32(6);
  out.push(0x00, format, 0x00, tracks.length, 0x01, 0xe0);
  for (const track of tracks) {
    out.push(0x4d, 0x54, 0x72, 0x6b);
    push32(track.length);
    out.push(...track);
  }
  return Uint8Array.from(out).buffer;
}

const END = [0x00, 0xff, 0x2f, 0x00];

describe('decodeMidi', () => {
  it('reads ppq, a tempo and a time signature off the conductor track', () => {
    const file = decodeMidi(
      fileOf(1, [
        [
          0x00,
          0xff,
          0x03,
          0x04,
          0x53,
          0x6f,
          0x6e,
          0x67, // name "Song"
          0x00,
          0xff,
          0x51,
          0x03,
          0x07,
          0xa1,
          0x20, // 120 bpm
          0x00,
          0xff,
          0x58,
          0x04,
          0x03,
          0x02,
          0x18,
          0x08, // 3/4
          ...END,
        ],
        [0x00, 0x90, 0x3c, 0x64, 0x83, 0x60, 0x80, 0x3c, 0x00, ...END],
      ]),
    );
    expect(file.header.ppq).toBe(480);
    expect(file.header.name).toBe('Song');
    expect(file.header.tempos).toEqual([{ ticks: 0, bpm: 120 }]);
    expect(file.header.timeSignatures).toEqual([{ ticks: 0, timeSignature: [3, 4] }]);
    // The conductor carries no channel events, so it is not a track.
    expect(file.tracks).toHaveLength(1);
  });

  it('pairs note on/off into a duration and normalizes velocity', () => {
    const file = decodeMidi(
      fileOf(0, [[0x00, 0x90, 0x3c, 0x64, 0x83, 0x60, 0x80, 0x3c, 0x00, ...END]]),
    );
    expect(file.tracks[0].notes).toEqual([
      { midi: 60, ticks: 0, durationTicks: 480, velocity: 100 / 127 },
    ]);
    expect(file.tracks[0].durationTicks).toBe(480);
    expect(file.tracks[0].durationSeconds).toBeCloseTo(0.5, 5);
  });

  it('treats a note-on at velocity 0 as a note-off', () => {
    const file = decodeMidi(
      fileOf(0, [[0x00, 0x90, 0x3c, 0x64, 0x83, 0x60, 0x90, 0x3c, 0x00, ...END]]),
    );
    expect(file.tracks[0].notes).toHaveLength(1);
    expect(file.tracks[0].notes[0].durationTicks).toBe(480);
  });

  it('applies running status to a bare data byte', () => {
    // One 0x90 status, then two note-ons and two note-offs with no status bytes.
    const file = decodeMidi(
      fileOf(0, [
        [
          0x00,
          0x90,
          0x3c,
          0x64,
          0x00,
          0x40,
          0x64,
          0x83,
          0x60,
          0x3c,
          0x00,
          0x00,
          0x40,
          0x00,
          ...END,
        ],
      ]),
    );
    expect(file.tracks[0].notes.map((n) => n.midi)).toEqual([60, 64]);
    expect(file.tracks[0].notes.every((n) => n.durationTicks === 480)).toBe(true);
  });

  it('keys control changes by number and normalizes their value', () => {
    const file = decodeMidi(fileOf(0, [[0x00, 0xb0, 0x07, 0x64, 0x00, 0xb0, 0x0a, 0x20, ...END]]));
    expect(file.tracks[0].controlChanges[7]).toEqual([{ number: 7, ticks: 0, value: 100 / 127 }]);
    expect(file.tracks[0].controlChanges[10][0].value).toBeCloseTo(32 / 127, 5);
  });

  it('names the instrument from the program change', () => {
    const file = decodeMidi(
      fileOf(0, [[0x00, 0xc0, 0x28, 0x00, 0x90, 0x3c, 0x64, 0x81, 0x70, 0x80, 0x3c, 0x00, ...END]]),
    );
    expect(file.tracks[0].instrument.number).toBe(40);
    expect(file.tracks[0].instrument.name).toBe('Violin');
  });

  it('closes a note the file never released at the end of the track', () => {
    const file = decodeMidi(fileOf(0, [[0x00, 0x90, 0x3c, 0x64, 0x83, 0x60, 0xff, 0x2f, 0x00]]));
    expect(file.tracks[0].notes[0].durationTicks).toBe(480);
  });

  it('changes tempo partway and reports seconds against the map', () => {
    const file = decodeMidi(
      fileOf(1, [
        [
          0x00,
          0xff,
          0x51,
          0x03,
          0x07,
          0xa1,
          0x20, // 120 bpm at tick 0
          0x8f,
          0x00,
          0xff,
          0x51,
          0x03,
          0x0a,
          0x2c,
          0x2a, // 90 bpm at tick 1920
          ...END,
        ],
        [0x8f, 0x00, 0x90, 0x3c, 0x64, 0x83, 0x60, 0x80, 0x3c, 0x00, ...END],
      ]),
    );
    expect(file.header.tempos).toHaveLength(2);
    // 1920 ticks at 120bpm = 2s, then 480 more at 90bpm = 0.666s.
    expect(file.tracks[0].durationSeconds).toBeCloseTo(2 + 60 / 90, 3);
  });

  it('rejects a file that is not a Standard MIDI File', () => {
    expect(() => decodeMidi(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow(
      MidiParseError,
    );
  });

  it('rejects SMPTE division, which this reader does not support', () => {
    const buffer = new Uint8Array(fileOf(0, [[...END]]));
    buffer[12] = 0xe7; // negative SMPTE format in the high bit
    expect(() => decodeMidi(buffer.buffer)).toThrow(/SMPTE/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd ~/projects/music_codecs && bun run test -- src/midi/decode.test.ts
```

Expected: FAIL — `Failed to resolve import "./decode.js"`.

- [ ] **Step 3: Write `src/midi/decode.ts`**

```ts
import { gmInstrument } from '@sudobility/music_types';
import type {
  MidiControlChange,
  MidiFile,
  MidiNote,
  MidiTempoEvent,
  MidiTimeSignatureEvent,
  MidiTrackData,
} from '@sudobility/music_types';
import { ByteReader } from './bytes.js';
import { MidiParseError } from './errors.js';

const META_TRACK_NAME = 0x03;
const META_END_OF_TRACK = 0x2f;
const META_TEMPO = 0x51;
const META_TIME_SIGNATURE = 0x58;

const MICROSECONDS_PER_MINUTE = 60_000_000;
const DEFAULT_BPM = 120;
const MAX_7_BIT = 127;

type ChannelEvent =
  | { kind: 'noteOn'; ticks: number; channel: number; note: number; velocity: number }
  | { kind: 'noteOff'; ticks: number; channel: number; note: number }
  | { kind: 'controlChange'; ticks: number; channel: number; controller: number; value: number }
  | { kind: 'programChange'; ticks: number; channel: number; program: number };

type ParsedTrack = {
  name: string;
  events: ChannelEvent[];
  tempos: MidiTempoEvent[];
  timeSignatures: MidiTimeSignatureEvent[];
  endTicks: number;
};

function asciiOf(data: Uint8Array): string {
  let out = '';
  for (const byte of data) out += String.fromCharCode(byte);
  return out;
}

/**
 * Reads one `MTrk` body into channel events plus the global meta events it
 * happens to carry.
 *
 * Tempo and time signature are collected per track and merged by the caller:
 * they are properties of the piece rather than of a part, and while they
 * conventionally sit on track 0, nothing in the format requires it.
 */
function readTrackChunk(reader: ByteReader, length: number): ParsedTrack {
  const end = reader.position + length;
  const track: ParsedTrack = {
    name: '',
    events: [],
    tempos: [],
    timeSignatures: [],
    endTicks: 0,
  };
  let ticks = 0;
  let status = 0;

  while (reader.position < end) {
    ticks += reader.varint();
    let byte = reader.uint8();

    if (byte < 0x80) {
      // Running status: the status byte is implied, and this byte is already
      // the first data byte — so step back over it and re-read under `status`.
      if (status === 0) {
        throw new MidiParseError(
          `A data byte appeared before any status byte at ${reader.position - 1}.`,
        );
      }
      reader.seek(reader.position - 1);
      byte = status;
    } else if (byte < 0xf0) {
      status = byte;
    } else {
      // System and meta messages cancel running status.
      status = 0;
    }

    if (byte === 0xff) {
      const type = reader.uint8();
      const data = reader.bytes(reader.varint());
      if (type === META_TRACK_NAME) {
        track.name = asciiOf(data);
      } else if (type === META_TEMPO && data.length === 3) {
        const microseconds = (data[0] << 16) | (data[1] << 8) | data[2];
        if (microseconds > 0) {
          track.tempos.push({ ticks, bpm: MICROSECONDS_PER_MINUTE / microseconds });
        }
      } else if (type === META_TIME_SIGNATURE && data.length >= 2) {
        track.timeSignatures.push({
          ticks,
          timeSignature: [data[0], 2 ** data[1]],
        });
      } else if (type === META_END_OF_TRACK) {
        track.endTicks = Math.max(track.endTicks, ticks);
        break;
      }
      continue;
    }

    if (byte === 0xf0 || byte === 0xf7) {
      reader.bytes(reader.varint()); // sysex — length-prefixed, and nothing here reads it
      continue;
    }

    const channel = byte & 0x0f;
    switch (byte & 0xf0) {
      case 0x80: {
        const note = reader.uint8();
        reader.uint8();
        track.events.push({ kind: 'noteOff', ticks, channel, note });
        break;
      }
      case 0x90: {
        const note = reader.uint8();
        const velocity = reader.uint8();
        // A note-on at velocity 0 is a note-off. Many writers emit that rather
        // than a real one, and taking it literally leaves the note sounding
        // for the rest of the piece.
        track.events.push(
          velocity === 0
            ? { kind: 'noteOff', ticks, channel, note }
            : { kind: 'noteOn', ticks, channel, note, velocity: velocity / MAX_7_BIT },
        );
        break;
      }
      case 0xb0: {
        const controller = reader.uint8();
        const value = reader.uint8();
        track.events.push({
          kind: 'controlChange',
          ticks,
          channel,
          controller,
          value: value / MAX_7_BIT,
        });
        break;
      }
      case 0xc0: {
        track.events.push({ kind: 'programChange', ticks, channel, program: reader.uint8() });
        break;
      }
      case 0xa0:
      case 0xe0:
        reader.skip(2); // polyphonic aftertouch, pitch bend
        break;
      case 0xd0:
        reader.skip(1); // channel aftertouch
        break;
      default:
        throw new MidiParseError(
          `Unknown status byte 0x${byte.toString(16)} at ${reader.position - 1}.`,
        );
    }
    track.endTicks = Math.max(track.endTicks, ticks);
  }

  reader.seek(end);
  return track;
}

/** Where a tick falls in seconds, walking the tempo map to get there. */
export function secondsAtTick(
  tick: number,
  tempos: readonly MidiTempoEvent[],
  ppq: number,
): number {
  let seconds = 0;
  let cursor = 0;
  let bpm = DEFAULT_BPM;
  for (const tempo of tempos) {
    if (tempo.ticks >= tick) break;
    seconds += ((tempo.ticks - cursor) / ppq) * (60 / bpm);
    cursor = tempo.ticks;
    bpm = tempo.bpm;
  }
  return seconds + ((tick - cursor) / ppq) * (60 / bpm);
}

function notesFrom(events: readonly ChannelEvent[], endTicks: number): MidiNote[] {
  const open = new Map<number, { ticks: number; velocity: number }[]>();
  const notes: MidiNote[] = [];

  for (const event of events) {
    if (event.kind === 'noteOn') {
      const queue = open.get(event.note);
      const started = { ticks: event.ticks, velocity: event.velocity };
      if (queue) queue.push(started);
      else open.set(event.note, [started]);
    } else if (event.kind === 'noteOff') {
      const started = open.get(event.note)?.shift();
      if (started) {
        notes.push({
          midi: event.note,
          ticks: started.ticks,
          durationTicks: event.ticks - started.ticks,
          velocity: started.velocity,
        });
      }
    }
  }

  // A note the file never released ends where the track does. The sound was
  // written; only its release was not, and dropping it loses real music.
  for (const [note, queue] of open) {
    for (const started of queue) {
      notes.push({
        midi: note,
        ticks: started.ticks,
        durationTicks: Math.max(0, endTicks - started.ticks),
        velocity: started.velocity,
      });
    }
  }

  return notes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
}

function controlChangesFrom(events: readonly ChannelEvent[]): Record<number, MidiControlChange[]> {
  const out: Record<number, MidiControlChange[]> = {};
  for (const event of events) {
    if (event.kind !== 'controlChange') continue;
    // No `??=`: this package targets ES2020 so the server can consume it.
    if (!out[event.controller]) out[event.controller] = [];
    out[event.controller].push({
      number: event.controller,
      ticks: event.ticks,
      value: event.value,
    });
  }
  return out;
}

function trackFrom(
  name: string,
  events: readonly ChannelEvent[],
  endTicks: number,
  tempos: readonly MidiTempoEvent[],
  ppq: number,
): MidiTrackData {
  const notes = notesFrom(events, endTicks);
  const program = events.find(
    (event): event is Extract<ChannelEvent, { kind: 'programChange' }> =>
      event.kind === 'programChange',
  );
  const number = program ? program.program : 0;
  const durationTicks = notes.reduce(
    (max, note) => Math.max(max, note.ticks + note.durationTicks),
    0,
  );

  return {
    name,
    channel: events.length > 0 ? events[0].channel : 0,
    instrument: { number, name: gmInstrument(number)?.name },
    notes,
    controlChanges: controlChangesFrom(events),
    durationTicks,
    durationSeconds: secondsAtTick(durationTicks, tempos, ppq),
  };
}

/** A leading chunk carrying no channel events at all is the conductor track. */
function isConductor(track: ParsedTrack | undefined): boolean {
  return track !== undefined && track.events.length === 0;
}

/**
 * Format 0 is one chunk carrying every channel. Split it into one track per
 * channel that has events, in channel order.
 *
 * This is where this codec deliberately differs from `@tonejs/midi`, which
 * splits on program-change boundaries instead: on a two-channel file that
 * produces *three* tracks — a phantom one labelled with the wrong channel
 * holding the second channel's tick-0 CC7/CC10, and the second channel's real
 * notes stranded with no controllers at all. `withFormatZeroSetupControls`
 * existed in four copies to patch that up after the fact. Splitting by the
 * channel each event actually names needs no patching.
 */
function splitByChannel(
  track: ParsedTrack | undefined,
  tempos: readonly MidiTempoEvent[],
  ppq: number,
): MidiTrackData[] {
  if (!track) return [];
  const byChannel = new Map<number, ChannelEvent[]>();
  for (const event of track.events) {
    const existing = byChannel.get(event.channel);
    if (existing) existing.push(event);
    else byChannel.set(event.channel, [event]);
  }
  return [...byChannel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, events]) => trackFrom(track.name, events, track.endTicks, tempos, ppq));
}

/** Reads a Standard MIDI File into the neutral model. */
export function decodeMidi(data: ArrayBuffer): MidiFile {
  const reader = new ByteReader(data);
  if (reader.remaining < 14 || reader.ascii(4) !== 'MThd') {
    throw new MidiParseError('Not a Standard MIDI File: the MThd header chunk is missing.');
  }
  const headerLength = reader.uint32();
  const format = reader.uint16();
  reader.uint16(); // declared track count — the chunks actually present win
  const division = reader.uint16();
  if ((division & 0x8000) !== 0) {
    throw new MidiParseError(
      'SMPTE timecode division is not supported; this reader needs ticks per quarter note.',
    );
  }
  const ppq = division;
  reader.seek(8 + headerLength);

  const parsed: ParsedTrack[] = [];
  while (reader.remaining >= 8) {
    const id = reader.ascii(4);
    const length = reader.uint32();
    if (id === 'MTrk') parsed.push(readTrackChunk(reader, length));
    else reader.skip(length); // an unrecognised chunk type is skippable by spec
  }

  const tempos = parsed.flatMap((track) => track.tempos).sort((a, b) => a.ticks - b.ticks);
  const timeSignatures = parsed
    .flatMap((track) => track.timeSignatures)
    .sort((a, b) => a.ticks - b.ticks);

  const tracks =
    format === 0
      ? splitByChannel(parsed[0], tempos, ppq)
      : (isConductor(parsed[0]) ? parsed.slice(1) : parsed).map((track) =>
          trackFrom(track.name, track.events, track.endTicks, tempos, ppq),
        );

  const conductor = format !== 0 && isConductor(parsed[0]) ? parsed[0] : undefined;

  return {
    header: {
      ppq,
      name: conductor && conductor.name !== '' ? conductor.name : undefined,
      tempos,
      timeSignatures,
    },
    tracks,
    duration: tracks.reduce((max, track) => Math.max(max, track.durationSeconds), 0),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/projects/music_codecs && bun run test -- src/midi/decode.test.ts && bun run format && bun run typecheck
```

Expected: PASS, 10 cases.

- [ ] **Step 5: Commit** (only if asked)

```bash
git add src/midi/decode.ts src/midi/decode.test.ts
git commit -m "feat: add a hand-written SMF decoder to music_codecs"
```

---

### Task 5: music_codecs — `encodeMidi`

**Repo:** `~/projects/music_codecs`

**Files:**

- Create: `src/midi/encode.ts`
- Test: `src/midi/encode.test.ts`

**Interfaces:**

- Consumes: Task 3's `ByteWriter`; Task 4's `decodeMidi` (for round-trip assertions); the `Midi*` model types.
- Produces: `encodeMidi(file: MidiFile): Uint8Array`.

**Layout contract** — this matches what `@tonejs/midi` emits today, verified by probe, so existing consumers see no change:

- `MThd`, length 6, **format 1**, `ntrks = tracks.length + 1`, division = `ppq`.
- **Chunk 0 is the conductor**: optional track-name meta from `header.name`, then tempo and time-signature metas in tick order, then end-of-track. It carries no channel events, which is exactly what `decodeMidi` uses to recognise and drop it.
- **Chunks 1..n are the parts**: track-name meta, program change, then controllers and notes in tick order, then end-of-track.
- **At one tick, note-offs come before controllers, which come before note-ons.** Conventional practice, not a correctness requirement — measured: a repeated pitch round-trips correctly through both this decoder and `@tonejs/midi` with the order reversed, since both pair note-ons to note-offs FIFO. Kept for readers that pair by last-open-note instead, where an attack ahead of its release merges two notes into one.

- [ ] **Step 1: Write the failing test**

`src/midi/encode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MidiFile, MidiTrackData } from '@sudobility/music_types';
import { encodeMidi } from './encode.js';
import { decodeMidi } from './decode.js';

function track(overrides: Partial<MidiTrackData> = {}): MidiTrackData {
  return {
    name: 'Lead',
    channel: 0,
    instrument: { number: 0, name: 'Acoustic Grand Piano' },
    notes: [{ midi: 60, ticks: 0, durationTicks: 480, velocity: 100 / 127 }],
    controlChanges: {},
    durationTicks: 480,
    durationSeconds: 0.5,
    ...overrides,
  };
}

function file(overrides: Partial<MidiFile> = {}): MidiFile {
  return {
    header: {
      ppq: 480,
      name: 'Song',
      tempos: [{ ticks: 0, bpm: 120 }],
      timeSignatures: [{ ticks: 0, timeSignature: [4, 4] }],
    },
    tracks: [track()],
    duration: 0.5,
    ...overrides,
  };
}

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

describe('encodeMidi', () => {
  it('writes a format-1 header with a conductor chunk ahead of the parts', () => {
    const bytes = encodeMidi(file({ tracks: [track(), track({ channel: 1 })] }));
    const view = new DataView(asBuffer(bytes));
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('MThd');
    expect(view.getUint32(4)).toBe(6);
    expect(view.getUint16(8)).toBe(1); // format 1
    expect(view.getUint16(10)).toBe(3); // conductor + 2 parts
    expect(view.getUint16(12)).toBe(480); // ppq
  });

  it('round-trips a file through decodeMidi', () => {
    const original = file();
    const back = decodeMidi(asBuffer(encodeMidi(original)));
    expect(back.header.ppq).toBe(480);
    expect(back.header.name).toBe('Song');
    expect(back.header.timeSignatures).toEqual([{ ticks: 0, timeSignature: [4, 4] }]);
    expect(back.header.tempos[0].bpm).toBeCloseTo(120, 4);
    expect(back.tracks).toHaveLength(1);
    expect(back.tracks[0].name).toBe('Lead');
    expect(back.tracks[0].notes).toEqual(original.tracks[0].notes);
  });

  it('round-trips control changes keyed by number', () => {
    const original = file({
      tracks: [
        track({
          controlChanges: {
            7: [{ number: 7, ticks: 0, value: 100 / 127 }],
            10: [{ number: 10, ticks: 0, value: 32 / 127 }],
          },
        }),
      ],
    });
    const back = decodeMidi(asBuffer(encodeMidi(original)));
    expect(back.tracks[0].controlChanges[7][0].value).toBeCloseTo(100 / 127, 5);
    expect(back.tracks[0].controlChanges[10][0].value).toBeCloseTo(32 / 127, 5);
  });

  it('round-trips the program change', () => {
    const original = file({ tracks: [track({ instrument: { number: 40, name: 'Violin' } })] });
    const back = decodeMidi(asBuffer(encodeMidi(original)));
    expect(back.tracks[0].instrument.number).toBe(40);
    expect(back.tracks[0].instrument.name).toBe('Violin');
  });

  it('keeps a repeated pitch as two notes, not one long one', () => {
    // The release of the first lands on the same tick as the attack of the
    // second. Order them wrongly and they read back as a single 960-tick note.
    const original = file({
      tracks: [
        track({
          notes: [
            { midi: 60, ticks: 0, durationTicks: 480, velocity: 0.5 },
            { midi: 60, ticks: 480, durationTicks: 480, velocity: 0.5 },
          ],
          durationTicks: 960,
        }),
      ],
    });
    const back = decodeMidi(asBuffer(encodeMidi(original)));
    expect(back.tracks[0].notes).toHaveLength(2);
    expect(back.tracks[0].notes.map((n) => n.durationTicks)).toEqual([480, 480]);
  });

  it('round-trips a mid-piece tempo change', () => {
    const original = file({
      header: {
        ppq: 480,
        name: 'Song',
        tempos: [
          { ticks: 0, bpm: 120 },
          { ticks: 1920, bpm: 90 },
        ],
        timeSignatures: [],
      },
    });
    const back = decodeMidi(asBuffer(encodeMidi(original)));
    expect(back.header.tempos.map((t) => t.ticks)).toEqual([0, 1920]);
    // SMF stores integer microseconds per quarter, so 90bpm returns 90.00009.
    expect(back.header.tempos[1].bpm).toBeCloseTo(90, 3);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd ~/projects/music_codecs && bun run test -- src/midi/encode.test.ts
```

Expected: FAIL — `Failed to resolve import "./encode.js"`.

- [ ] **Step 3: Write `src/midi/encode.ts`**

```ts
import type { MidiFile, MidiTrackData } from '@sudobility/music_types';
import { ByteWriter } from './bytes.js';

const META_TRACK_NAME = 0x03;
const META_END_OF_TRACK = 0x2f;
const META_TEMPO = 0x51;
const META_TIME_SIGNATURE = 0x58;

const MICROSECONDS_PER_MINUTE = 60_000_000;
const MAX_7_BIT = 127;
/** MIDI clocks per metronome click, and 32nd notes per quarter — the conventional defaults. */
const CLOCKS_PER_CLICK = 24;
const THIRTY_SECONDS_PER_QUARTER = 8;

/** The model normalizes to 0-1; the wire wants 0-127. */
function to7Bit(value: number): number {
  return Math.max(0, Math.min(MAX_7_BIT, Math.round(value * MAX_7_BIT)));
}

function writeTextMeta(out: ByteWriter, type: number, text: string): void {
  out.uint8(0xff);
  out.uint8(type);
  out.varint(text.length);
  out.ascii(text);
}

function writeEndOfTrack(out: ByteWriter): void {
  out.varint(0);
  out.bytes([0xff, META_END_OF_TRACK, 0x00]);
}

/**
 * SMF stores tempo as integer microseconds per quarter note, so a bpm that is
 * not a divisor of 60,000,000 cannot survive a round trip exactly — 90 comes
 * back as 90.00009. That is the format's limit, not a rounding choice here.
 */
function writeTempo(out: ByteWriter, bpm: number): void {
  const microseconds = Math.round(MICROSECONDS_PER_MINUTE / bpm);
  out.bytes([
    0xff,
    META_TEMPO,
    0x03,
    (microseconds >>> 16) & 0xff,
    (microseconds >>> 8) & 0xff,
    microseconds & 0xff,
  ]);
}

function writeTimeSignature(
  out: ByteWriter,
  [numerator, denominator]: readonly [number, number],
): void {
  out.bytes([
    0xff,
    META_TIME_SIGNATURE,
    0x04,
    numerator,
    Math.round(Math.log2(denominator)),
    CLOCKS_PER_CLICK,
    THIRTY_SECONDS_PER_QUARTER,
  ]);
}

function writeChunk(out: ByteWriter, body: Uint8Array): void {
  out.ascii('MTrk');
  out.uint32(body.length);
  out.bytes(body);
}

/**
 * Chunk 0: the piece's name and its tempo and metre map, and no channel
 * events at all — which is precisely what `decodeMidi` recognises it by.
 */
function conductorChunk(file: MidiFile): Uint8Array {
  const out = new ByteWriter();
  if (file.header.name) {
    out.varint(0);
    writeTextMeta(out, META_TRACK_NAME, file.header.name);
  }

  const events: { ticks: number; write: (to: ByteWriter) => void }[] = [
    ...file.header.tempos.map((tempo) => ({
      ticks: tempo.ticks,
      write: (to: ByteWriter) => writeTempo(to, tempo.bpm),
    })),
    ...file.header.timeSignatures.map((signature) => ({
      ticks: signature.ticks,
      write: (to: ByteWriter) => writeTimeSignature(to, signature.timeSignature),
    })),
  ].sort((a, b) => a.ticks - b.ticks);

  let ticks = 0;
  for (const event of events) {
    out.varint(event.ticks - ticks);
    ticks = event.ticks;
    event.write(out);
  }

  writeEndOfTrack(out);
  return out.toUint8Array();
}

/**
 * Ordering within a tick: releases (0), then controllers (1), then attacks (2).
 *
 * A note-off for a pitch that is immediately re-struck has to be written before
 * the matching note-on, or the reader pairs the first attack with the second
 * release and the two notes come back as one.
 */
const RELEASE = 0;
const CONTROLLER = 1;
const ATTACK = 2;

function trackChunk(track: MidiTrackData): Uint8Array {
  const channel = track.channel & 0x0f;
  const events: { ticks: number; order: number; bytes: number[] }[] = [];

  for (const changes of Object.values(track.controlChanges)) {
    for (const cc of changes) {
      events.push({
        ticks: cc.ticks,
        order: CONTROLLER,
        bytes: [0xb0 | channel, cc.number & 0x7f, to7Bit(cc.value)],
      });
    }
  }

  for (const note of track.notes) {
    events.push({
      ticks: note.ticks,
      order: ATTACK,
      bytes: [0x90 | channel, note.midi & 0x7f, to7Bit(note.velocity)],
    });
    events.push({
      ticks: note.ticks + note.durationTicks,
      order: RELEASE,
      bytes: [0x80 | channel, note.midi & 0x7f, 0x00],
    });
  }

  events.sort((a, b) => a.ticks - b.ticks || a.order - b.order);

  const out = new ByteWriter();
  out.varint(0);
  writeTextMeta(out, META_TRACK_NAME, track.name);
  out.varint(0);
  out.bytes([0xc0 | channel, track.instrument.number & 0x7f]);

  let ticks = 0;
  for (const event of events) {
    out.varint(event.ticks - ticks);
    ticks = event.ticks;
    out.bytes(event.bytes);
  }

  writeEndOfTrack(out);
  return out.toUint8Array();
}

/** Writes the neutral model out as a Standard MIDI File. */
export function encodeMidi(file: MidiFile): Uint8Array {
  const out = new ByteWriter();
  out.ascii('MThd');
  out.uint32(6);
  out.uint16(1); // format 1: a conductor chunk plus one chunk per part
  out.uint16(file.tracks.length + 1);
  out.uint16(file.header.ppq);

  writeChunk(out, conductorChunk(file));
  for (const track of file.tracks) writeChunk(out, trackChunk(track));

  return out.toUint8Array();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/projects/music_codecs && bun run test -- src/midi/encode.test.ts && bun run format && bun run typecheck
```

Expected: PASS, 6 cases.

- [ ] **Step 5: Commit** (only if asked)

```bash
git add src/midi/encode.ts src/midi/encode.test.ts
git commit -m "feat: add a hand-written SMF encoder to music_codecs"
```

---

### Task 6: music_codecs — the `@tonejs/midi` oracle, and the format-0 fix

**Repo:** `~/projects/music_codecs`

This is the task that makes Task 4 and Task 5 trustworthy. There is not one `.mid` fixture file anywhere in the family, so every other MIDI test round-trips through the codec under test — a codec that is self-consistent but spec-wrong passes all of them. `@tonejs/midi` is a mature independent implementation and is already a devDependency; using it as an oracle costs nothing at runtime.

**Files:**

- Create: `src/midi/oracle.test.ts`, `src/midi/format-zero.test.ts`
- Modify: `src/__architecture.test.ts`

**Interfaces:**

- Consumes: `decodeMidi`, `encodeMidi`.
- Produces: no source symbols — tests only.

- [ ] **Step 1: Write the format-0 regression test**

`src/midi/format-zero.test.ts`. The byte string below is a real two-channel format-0 track. Measured against `@tonejs/midi` it yields **three** tracks: channel 0's notes with its CC7/CC10; a phantom track reporting `channel: 0` that holds channel 1's CC7; and channel 1's notes with **no** controllers at all. That is the defect `withFormatZeroSetupControls` patched up in four separate copies.

```ts
import { describe, expect, it } from 'vitest';
import { decodeMidi } from './decode.js';

/** A format-0 file: one chunk, two channels, controllers at tick 0. */
function twoChannelFormatZero(): ArrayBuffer {
  const events = [
    0x00,
    0xff,
    0x51,
    0x03,
    0x07,
    0xa1,
    0x20, // 120 bpm
    0x00,
    0xb0,
    0x07,
    0x64, // ch0 CC7 = 100
    0x00,
    0xb0,
    0x0a,
    0x20, // ch0 CC10 = 32
    0x00,
    0xb1,
    0x07,
    0x50, // ch1 CC7 = 80
    0x00,
    0xc0,
    0x00, // ch0 program 0
    0x00,
    0xc1,
    0x28, // ch1 program 40
    0x00,
    0x90,
    0x3c,
    0x64, // ch0 note on C4
    0x00,
    0x91,
    0x40,
    0x64, // ch1 note on E4
    0x83,
    0x60,
    0x80,
    0x3c,
    0x00, // +480 ch0 note off
    0x00,
    0x81,
    0x40,
    0x00, // ch1 note off
    0x00,
    0xff,
    0x2f,
    0x00, // end of track
  ];
  const out: number[] = [];
  const push32 = (v: number) =>
    out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  out.push(0x4d, 0x54, 0x68, 0x64);
  push32(6);
  out.push(0x00, 0x00, 0x00, 0x01, 0x01, 0xe0); // format 0, 1 chunk, 480 ppq
  out.push(0x4d, 0x54, 0x72, 0x6b);
  push32(events.length);
  out.push(...events);
  return Uint8Array.from(out).buffer;
}

describe('format 0', () => {
  it('splits into exactly one track per channel', () => {
    const file = decodeMidi(twoChannelFormatZero());
    // @tonejs/midi returns three here: it splits on program-change boundaries
    // and emits a phantom track for channel 1's tick-0 controllers.
    expect(file.tracks).toHaveLength(2);
    expect(file.tracks.map((t) => t.channel)).toEqual([0, 1]);
  });

  it('keeps every channel with the controllers that were written for it', () => {
    const [first, second] = decodeMidi(twoChannelFormatZero()).tracks;

    expect(first.instrument.number).toBe(0);
    expect(first.controlChanges[7][0].value).toBeCloseTo(100 / 127, 5);
    expect(first.controlChanges[10][0].value).toBeCloseTo(32 / 127, 5);

    // This is the regression. @tonejs/midi strands channel 1's CC7 on the
    // phantom track and hands this one `controlChanges: {}`, which is what
    // withFormatZeroSetupControls existed to copy back in.
    expect(second.instrument.number).toBe(40);
    expect(second.controlChanges[7][0].value).toBeCloseTo(80 / 127, 5);
  });

  it('gives each channel only its own notes', () => {
    const [first, second] = decodeMidi(twoChannelFormatZero()).tracks;
    expect(first.notes.map((n) => n.midi)).toEqual([60]);
    expect(second.notes.map((n) => n.midi)).toEqual([64]);
  });
});
```

- [ ] **Step 2: Write the oracle test**

`src/midi/oracle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as midiModule from '@tonejs/midi';
import type { MidiFile } from '@sudobility/music_types';
import { decodeMidi } from './decode.js';
import { encodeMidi } from './encode.js';

/**
 * `@tonejs/midi` as an independent implementation to check ours against.
 *
 * A devDependency and a test-only import: this package ships with
 * `dependencies: []`, and `__architecture.test.ts` keeps `@tonejs/midi` on its
 * forbidden list for `src/`. It is here because there is no real `.mid`
 * fixture anywhere in the family, so without a second implementation every
 * MIDI test round-trips through the codec under test and a spec-wrong codec
 * passes all of them.
 *
 * `@tonejs/midi` publishes CommonJS as `main` and ESM only via `module`, so
 * which shape a named import resolves to depends on the runner. Reading the
 * constructor off the namespace works under all of them.
 */
type MidiConstructor = typeof import('@tonejs/midi').Midi;
const namespace = midiModule as unknown as {
  Midi?: MidiConstructor;
  default?: { Midi: MidiConstructor };
};
const Midi: MidiConstructor = namespace.Midi ?? namespace.default!.Midi;

const SAMPLE: MidiFile = {
  header: {
    ppq: 480,
    name: 'Oracle',
    tempos: [
      { ticks: 0, bpm: 120 },
      { ticks: 1920, bpm: 90 },
    ],
    timeSignatures: [{ ticks: 0, timeSignature: [3, 4] }],
  },
  tracks: [
    {
      name: 'Right',
      channel: 0,
      instrument: { number: 0, name: 'Acoustic Grand Piano' },
      notes: [
        { midi: 60, ticks: 0, durationTicks: 480, velocity: 100 / 127 },
        { midi: 64, ticks: 480, durationTicks: 240, velocity: 80 / 127 },
        { midi: 67, ticks: 960, durationTicks: 960, velocity: 127 / 127 },
      ],
      controlChanges: {
        7: [{ number: 7, ticks: 0, value: 100 / 127 }],
        10: [{ number: 10, ticks: 0, value: 32 / 127 }],
      },
      durationTicks: 1920,
      durationSeconds: 2,
    },
    {
      name: 'Left',
      channel: 1,
      instrument: { number: 40, name: 'Violin' },
      notes: [{ midi: 48, ticks: 0, durationTicks: 1920, velocity: 64 / 127 }],
      controlChanges: {},
      durationTicks: 1920,
      durationSeconds: 2,
    },
  ],
  duration: 2,
};

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

describe('our encoder against @tonejs/midi', () => {
  it('writes bytes @tonejs/midi reads back with the same notes', () => {
    const theirs = new Midi(asBuffer(encodeMidi(SAMPLE)));

    expect(theirs.header.ppq).toBe(480);
    expect(theirs.header.name).toBe('Oracle');
    expect(theirs.header.timeSignatures[0].timeSignature).toEqual([3, 4]);
    expect(theirs.header.tempos.map((t) => t.ticks)).toEqual([0, 1920]);
    expect(theirs.header.tempos[0].bpm).toBeCloseTo(120, 3);
    expect(theirs.header.tempos[1].bpm).toBeCloseTo(90, 3);

    expect(theirs.tracks).toHaveLength(2);
    for (const [index, track] of theirs.tracks.entries()) {
      const ours = SAMPLE.tracks[index];
      expect(track.name).toBe(ours.name);
      expect(track.channel).toBe(ours.channel);
      expect(track.instrument.number).toBe(ours.instrument.number);
      expect(track.notes.map((n) => n.midi)).toEqual(ours.notes.map((n) => n.midi));
      expect(track.notes.map((n) => n.ticks)).toEqual(ours.notes.map((n) => n.ticks));
      expect(track.notes.map((n) => n.durationTicks)).toEqual(
        ours.notes.map((n) => n.durationTicks),
      );
      for (const [i, note] of track.notes.entries()) {
        expect(note.velocity).toBeCloseTo(ours.notes[i].velocity, 2);
      }
    }
  });

  it('preserves the controllers @tonejs/midi reads back', () => {
    const theirs = new Midi(asBuffer(encodeMidi(SAMPLE)));
    expect(theirs.tracks[0].controlChanges[7]?.[0].value).toBeCloseTo(100 / 127, 2);
    expect(theirs.tracks[0].controlChanges[10]?.[0].value).toBeCloseTo(32 / 127, 2);
  });
});

describe('our decoder against @tonejs/midi', () => {
  it('reads bytes @tonejs/midi wrote', () => {
    const theirs = new Midi();
    theirs.header.fromJSON({
      name: 'Oracle',
      ppq: 480,
      meta: [],
      tempos: SAMPLE.header.tempos.map((t) => ({ ticks: t.ticks, bpm: t.bpm })),
      timeSignatures: SAMPLE.header.timeSignatures.map((s) => ({
        ticks: s.ticks,
        timeSignature: s.timeSignature,
      })),
      keySignatures: [],
    });
    for (const source of SAMPLE.tracks) {
      const track = theirs.addTrack();
      track.name = source.name;
      track.channel = source.channel;
      track.instrument.number = source.instrument.number;
      for (const changes of Object.values(source.controlChanges)) {
        for (const cc of changes)
          track.addCC({ number: cc.number, ticks: cc.ticks, value: cc.value });
      }
      for (const note of source.notes) {
        track.addNote({
          midi: note.midi,
          ticks: note.ticks,
          durationTicks: note.durationTicks,
          velocity: note.velocity,
        });
      }
    }

    const ours = decodeMidi(asBuffer(theirs.toArray()));

    expect(ours.header.ppq).toBe(480);
    expect(ours.header.name).toBe('Oracle');
    expect(ours.header.timeSignatures).toEqual([{ ticks: 0, timeSignature: [3, 4] }]);
    expect(ours.header.tempos.map((t) => t.ticks)).toEqual([0, 1920]);
    expect(ours.header.tempos[1].bpm).toBeCloseTo(90, 3);

    expect(ours.tracks).toHaveLength(2);
    expect(ours.tracks.map((t) => t.name)).toEqual(['Right', 'Left']);
    expect(ours.tracks.map((t) => t.channel)).toEqual([0, 1]);
    expect(ours.tracks.map((t) => t.instrument.number)).toEqual([0, 40]);
    expect(ours.tracks[0].notes.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(ours.tracks[0].notes.map((n) => n.durationTicks)).toEqual([480, 240, 960]);
    expect(ours.tracks[1].notes.map((n) => n.midi)).toEqual([48]);
    expect(ours.tracks[0].controlChanges[7][0].value).toBeCloseTo(100 / 127, 2);
    expect(ours.tracks[0].durationSeconds).toBeCloseTo(2, 2);
  });
});
```

- [ ] **Step 3: Run both suites**

```bash
cd ~/projects/music_codecs
bun run test -- src/midi/format-zero.test.ts src/midi/oracle.test.ts
```

Expected: PASS, 6 cases. If the oracle disagrees, **our codec is wrong** — fix `decode.ts`/`encode.ts`, not the assertion.

- [ ] **Step 4: Pin the oracle's confinement in the architecture guard**

The existing `it('imports nothing from music_lib, music_io or a platform')` already covers `src/` because `sourceFiles()` filters out `.test.` files. Add an explicit test beside it in `src/__architecture.test.ts` so the _intent_ is recorded, not just the effect:

```ts
/**
 * `@tonejs/midi` is the independent implementation the MIDI codec is checked
 * against, and nothing more. It is a devDependency; the moment it appears in
 * shipped source, this package stops being installable without it.
 */
it('confines @tonejs/midi to tests', () => {
  const shipped = globSync('src/**/*.ts', { cwd: process.cwd() })
    .filter((f) => !f.includes('.test.'))
    .filter((f) => !f.startsWith('test/') && !f.includes('/test/'));
  const offenders = shipped.filter((f) =>
    readFileSync(join(process.cwd(), f), 'utf8').includes('@tonejs/midi'),
  );
  expect(offenders).toEqual([]);

  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  expect(pkg.devDependencies['@tonejs/midi']).toBeDefined();
  expect(pkg.dependencies?.['@tonejs/midi']).toBeUndefined();
  expect(pkg.peerDependencies?.['@tonejs/midi']).toBeUndefined();
});
```

- [ ] **Step 5: Verify**

```bash
cd ~/projects/music_codecs && bun run format && bun run test -- src/__architecture.test.ts src/midi
```

Expected: all pass.

- [ ] **Step 6: Commit** (only if asked)

```bash
git add src/midi/oracle.test.ts src/midi/format-zero.test.ts src/__architecture.test.ts
git commit -m "test: check the SMF codec against @tonejs/midi and pin the format-0 split"
```

---

### Task 7: music_codecs — drop the codec parameters and publish the new surface

**Repo:** `~/projects/music_codecs`

**Files:**

- Modify: `src/midi/import.ts:621-628`, `src/midi/analyze.ts:111-114`, `src/midi/export.ts:86,127`, `src/index.ts`
- Rename: `src/test/platform.ts` → `src/test/xml.ts`
- Test: every existing `src/midi/*.test.ts` and `src/musicxml/*.test.ts` that used `testMidiCodec()`

**Interfaces:**

- Consumes: `decodeMidi`, `encodeMidi`, `decodeTracker`, `encodeTracker`.
- Produces the package's final public surface:
  - `decodeMidi(data: ArrayBuffer): MidiFile`
  - `encodeMidi(file: MidiFile): Uint8Array`
  - `decodeTracker(bytes: ArrayBuffer): TrackerModule`
  - `encodeTracker(module: TrackerModule): ArrayBuffer`
  - `importMidi(data: ArrayBuffer, options: MidiImportOptions): MidiImportResult`
  - `analyzeMidi(data: ArrayBuffer): MidiSummary`
  - `exportMidi(score: Score): Uint8Array`
  - `MidiParseError`
  - unchanged: `importMidiFile(file, options)`, `analyzeMidiFile(file)`, `trackerToScore`, `scoreToTracker`, `isCleanFit`, `speedAndTempoFor`, `exportMusicXml`, `musicXmlSafeFilename`, `importMusicXml`

- [ ] **Step 1: Drop the parameter from `importMidi`**

In `src/midi/import.ts`, replace the last function and its comment:

```ts
/** Decodes `data` and imports it. */
export function importMidi(data: ArrayBuffer, options: MidiImportOptions): MidiImportResult {
  return importMidiFile(decodeMidi(data), options);
}
```

Add `import { decodeMidi } from './decode.js';` at the top and remove `MidiCodec` from the `@sudobility/music_types` type import list.

- [ ] **Step 2: Drop the parameter from `analyzeMidi`**

In `src/midi/analyze.ts`:

```ts
/** Decodes `data` and summarizes it. */
export function analyzeMidi(data: ArrayBuffer): MidiSummary {
  return analyzeMidiFile(decodeMidi(data));
}
```

Add `import { decodeMidi } from './decode.js';`, remove `MidiCodec` from the type import.

- [ ] **Step 3: Drop the parameter from `exportMidi`**

In `src/midi/export.ts`, change the signature at line 86 to `export function exportMidi(score: Score): Uint8Array {` and the return at line 127 to `return encodeMidi(file);`. Add `import { encodeMidi } from './encode.js';`, remove `MidiCodec` from the type import. Leave the long doc comment above it alone — it is about `flattenScoreNotes` and `fermataTempoMap` and is still accurate.

- [ ] **Step 4: Cut the MIDI half out of the test scaffolding**

```bash
cd ~/projects/music_codecs
git mv src/test/platform.ts src/test/xml.ts
```

In `src/test/xml.ts`, delete the `@tonejs/midi` import, the `MidiConstructor`/`namespace`/`Midi`/`missingMidi` block, `controlChangesFor`, `isTickZeroSetupTrack`, `withFormatZeroSetupControls`, `class ToneJsMidiCodec`, and `export function testMidiCodec`. Keep only `testXmlParser` and its jsdom imports. Replace the file's top doc comment with:

```ts
/**
 * A real XML parser for tests, via jsdom.
 *
 * XML is the one format still injected: `DOMParser` on the web and
 * `fast-xml-parser` on React Native are genuinely different implementations,
 * so `XmlParser` stays a platform capability while the MusicXML semantics live
 * here. The MIDI codec used to be faked alongside it and no longer is — the
 * real one is in `src/midi/`.
 *
 * `DOMParser` reports malformed input by returning a document rooted at
 * `<parsererror>` rather than by throwing, so that is checked explicitly.
 */
```

- [ ] **Step 5: Update every caller of the old signatures**

```bash
cd ~/projects/music_codecs
grep -rln "testMidiCodec\|from '../test/platform.js'\|from './test/platform.js'" src/
```

For each file the grep names:

- change `from '../test/platform.js'` to `from '../test/xml.js'` (keep `testXmlParser`; drop `testMidiCodec` from the import list),
- replace `importMidi(data, options, codec)` → `importMidi(data, options)`, `analyzeMidi(data, codec)` → `analyzeMidi(data)`, `exportMidi(score, codec)` → `exportMidi(score)`,
- delete now-unused `const codec = testMidiCodec();` lines.

- [ ] **Step 6: Update `src/index.ts`**

Replace the paragraph that begins "Raw byte work — parsing a MIDI file into tracks and notes, or XML into a DOM — belongs to `@sudobility/music_io`, which is injected" with:

```
 * Raw byte work lives here too: `decodeMidi`/`encodeMidi` read and write
 * Standard MIDI Files, and `decodeTracker`/`encodeTracker` do the same for the
 * module formats. Only XML is still injected — `DOMParser` on the web and
 * `fast-xml-parser` on React Native are genuinely different implementations,
 * so `XmlParser` stays a platform capability in `@sudobility/music_io` while
 * the MusicXML semantics live here.
```

Add to the MIDI section:

```ts
export * from './midi/errors.js';
export { decodeMidi } from './midi/decode.js';
export { encodeMidi } from './midi/encode.js';
```

Add a tracker section:

```ts
// ---- Tracker module bytes --------------------------------------------------
export { decodeTracker, encodeTracker } from './tracker/dispatch.js';
```

Do **not** `export *` from `src/tracker/` — the individual readers (`readIt`, `readXm`, …) and the fixture builders are internals of the dispatcher, and exporting them would make five format readers part of the public surface.

- [ ] **Step 7: Verify the whole package**

```bash
cd ~/projects/music_codecs
grep -rn "MidiCodec\|TrackerCodec" src/ || echo "clean"
bun run verify
```

Expected: `clean`, then format:check + typecheck + lint + all tests + build pass.

- [ ] **Step 8: Bump the version and commit** (only if asked)

```bash
npm version minor --no-git-tag-version   # 0.1.x -> 0.2.0: the public surface changed
git add -A && git commit -m "feat!: own the MIDI and tracker byte layer; drop the injected codec parameters"
```

---

### Task 8: music_io — delete the score formats and the two capabilities

**Repo:** `~/projects/music_io`

**Files:**

- Delete: `src/shared/mod/`, `src/shared/tracker/`, `src/shared/midi/codec.tonejs.ts`, `src/shared/midi/codec.tonejs.test.ts`
- Modify: `src/shared/types.ts`, `src/web/index.ts`, `src/rn/index.ts`, `src/mocks/index.ts`, `src/contract/platform-contract.ts`, `package.json`, `CLAUDE.md`

**Interfaces:**

- Consumes: nothing from `music_codecs` — `music_io` does **not** gain a dependency on it. It simply stops offering these two capabilities.
- Produces: a `MusicIo` type with these members and no others: `playback`, `xmlParser`, `audioCodec`, `audioRenderer`, `fileExporter`, `midiInput`.

- [ ] **Step 1: Confirm Task 2 copied everything, then delete**

```bash
cd ~/projects/music_io
diff -rq src/shared/tracker ~/projects/music_codecs/src/tracker | grep -v "^Only in.*music_codecs" || true
git rm -r src/shared/mod src/shared/tracker
git rm src/shared/midi/codec.tonejs.ts src/shared/midi/codec.tonejs.test.ts
ls src/shared/midi/   # expect only unsupported-midi-input.ts
```

`src/shared/midi/` keeps `unsupported-midi-input.ts`: **live MIDI input is a device capability, not a file format**, and stays here.

- [ ] **Step 2: Strip the two fields from `MusicIo`**

In `src/shared/types.ts`, remove `MidiCodec` and `TrackerCodec` from the type import, and delete these three lines (the comment included — the naming debt it describes is retired by the deletion):

```ts
midiCodec: MidiCodec;
/** Named `modCodec` still, for now: renaming it reaches into music_app and belongs with the change that widens the accepted extensions. */
modCodec: TrackerCodec;
```

Then update the type's doc comment to say what the package now provides:

```ts
/**
 * Everything a platform provides. Each entry point (`web`, `rn`, `mocks`)
 * exports a `createMusicIo()` returning one of these, so app code is identical
 * whichever platform resolved.
 *
 * Score formats are deliberately absent. MIDI files and tracker modules are
 * byte arithmetic against a published spec — no audio context, no DOM — so
 * they live in `@sudobility/music_codecs` and are imported directly. What is
 * left here genuinely needs a platform: sampled audio, playback, the
 * filesystem, and MIDI *input*, which is a device rather than a file.
 */
```

- [ ] **Step 3: Update the three entry points**

In `src/web/index.ts`: delete the `ToneJsMidiCodec` and `SharedTrackerCodec` imports, drop `ToneJsMidiCodec` from the `export { ... }` line, and delete the `midiCodec:` and `modCodec:` lines from the returned object.

In `src/rn/index.ts`: the same — delete both imports, drop `ToneJsMidiCodec` from its `export { ... }` line, delete both object fields.

In `src/mocks/index.ts`: delete both imports and both fields.

- [ ] **Step 4: Remove the moved contract assertions**

In `src/contract/platform-contract.ts`, delete the assertions at lines 64, 67, 74, 79, 121 and 140 — `io.midiCodec`/`io.modCodec` presence, the MOD-decode-throws case, the `buildMod` decode case, and the MIDI encode/decode round trip. Their coverage moved to `music_codecs` in Tasks 2 and 6; the platform contract is now about playback, XML, audio, file export and MIDI input. Delete any `buildMod` import left unused.

- [ ] **Step 5: Drop the dependency**

```bash
cd ~/projects/music_io
```

In `package.json`: remove `"@tonejs/midi"` from **both** `peerDependencies` and `devDependencies`. Update `description` — it currently reads "playback, XML parsing, file export and MIDI codecs, for web and React Native" — to:

```
"description": "Platform implementations for ScoreSmith: playback, audio codecs, XML parsing, file export and live MIDI input, for web and React Native",
```

Then reinstall so the lockfile matches:

```bash
bun install
```

- [ ] **Step 6: Verify**

```bash
cd ~/projects/music_io
grep -rn "midiCodec\|modCodec\|@tonejs/midi\|SharedTrackerCodec\|ToneJsMidiCodec" src/ package.json || echo "clean"
bun run verify
```

Expected: `clean`, then typecheck + lint + test + build pass. `src/contract/no-music-lib.test.ts` still passes — nothing here gained an import.

- [ ] **Step 7: Update `CLAUDE.md`**

Its charter describes this package as owning MIDI and tracker codecs. Rewrite that section to the rule: score formats (note-carrying — MIDI, MusicXML semantics, tracker modules) live in `@sudobility/music_codecs`; audio formats (sample-carrying — WAV, MP3) and true platform capabilities live here. Note explicitly that `XmlParser` stays because its two implementations genuinely differ, and that `MidiInput` is a device rather than a file format.

- [ ] **Step 8: Bump and commit** (only if asked)

```bash
npm version minor --no-git-tag-version
git add -A && git commit -m "feat!: drop the score-format codecs; music_io keeps audio and platform only"
```

---

### Task 9: music_lib — delete the third hand-copy

**Repo:** `~/projects/music_lib`

**Files:**

- Modify: `src/test/platform.ts` (delete lines 113–205, the MIDI half), `src/services/perf/benchmark.ts:112-122,194-205`, `src/services/perf/benchmark.test.ts:1,9`, `package.json`

**Interfaces:**

- Consumes: `encodeMidi`, `decodeMidi` from `@sudobility/music_codecs`.
- Produces: `runBenchmark(sizes?: BenchmarkSize[]): BenchmarkReport` — the `codec` parameter is gone, and it is now the **first** parameter that disappears, so a caller passing one positionally breaks loudly at the type level rather than silently benchmarking the wrong sizes.

- [ ] **Step 1: Install the new music_codecs locally and clear the caches**

```bash
cd ~/projects/music_codecs && bun run clean && bun run build
rsync -a --delete dist/ ~/projects/music_lib/node_modules/@sudobility/music_codecs/dist/
cp package.json ~/projects/music_lib/node_modules/@sudobility/music_codecs/package.json
rm -rf ~/projects/music_lib/node_modules/.vite
```

- [ ] **Step 2: Cut the MIDI half out of the test scaffolding**

In `src/test/platform.ts`, delete the `@tonejs/midi` import, the namespace/`Midi`/`missingMidi` block, `controlChangesFor`, `isTickZeroSetupTrack`, `withFormatZeroSetupControls`, `class ToneJsMidiCodec` (lines 113–204) and `export function testMidiCodec` (line 204–206). Remove `MidiCodec` and the now-unused `Midi*` types from the `@sudobility/music_types` import. Keep `testXmlParser` and everything it uses.

- [ ] **Step 3: Drop the codec parameter from the benchmark**

In `src/services/perf/benchmark.ts`:

```ts
function benchmarkSize(size: BenchmarkSize): BenchmarkSizeReport {
```

```ts
export function runBenchmark(
  sizes: BenchmarkSize[] = DEFAULT_BENCHMARK_SIZES
): BenchmarkReport {
  return {
    generatedAt: new Date().toISOString(),
    sizes: sizes.map(size => benchmarkSize(size)),
  };
```

Remove `MidiCodec` from the type import at line 21. Wherever the body called `codec.encode(...)` or `codec.decode(...)`, call `encodeMidi(...)` / `decodeMidi(...)` imported from `@sudobility/music_codecs`, and delete every remaining `, codec` argument inside `benchmarkSize`.

- [ ] **Step 4: Update the benchmark test**

In `src/services/perf/benchmark.test.ts`, delete line 1's `import { testMidiCodec } from '../../test/platform.js';` and line 9's `const codec = testMidiCodec();`, and remove `codec` from every `runBenchmark(...)` / `benchmarkSize(...)` call.

- [ ] **Step 5: Drop the dependency**

Remove `"@tonejs/midi"` from `devDependencies` in `package.json`, then `bun install`.

- [ ] **Step 6: Verify**

```bash
cd ~/projects/music_lib
grep -rn "MidiCodec\|testMidiCodec\|@tonejs/midi" src/ package.json || echo "clean"
bun run verify
```

Expected: `clean`, then all green. `src/index.ts:23`'s `export * from '@sudobility/music_codecs'` now re-exports `decodeMidi`, `encodeMidi`, `decodeTracker`, `encodeTracker` and `MidiParseError` automatically — this is what lets `music_app` reach them without a new dependency.

- [ ] **Step 7: Bump and commit** (only if asked)

```bash
npm version minor --no-git-tag-version
git add -A && git commit -m "refactor: take the MIDI codec from music_codecs instead of hand-copying it"
```

---

### Task 10: music_api — delete the fourth hand-copy

**Repo:** `~/projects/music_api`

**Files:**

- Delete: `src/services/transcription/midi-codec.ts`
- Modify: `src/services/transcription/settle.ts:19,61`, `package.json`

**Interfaces:**

- Consumes: `decodeMidi` from `@sudobility/music_codecs` (already a dependency at `^0.1.16`; bump to the version Task 7 published).
- Produces: nothing new.

This is the copy that most clearly shows the cost of the old boundary: it is **decode-only**, and its `encode` throws `'midi-codec: encoding is not supported on the server'` with a comment pointing at `music_io` as the only place that could do it. After this task the server can encode too, for free.

- [ ] **Step 1: Sync the new music_codecs**

```bash
cd ~/projects/music_codecs && bun run clean && bun run build
rsync -a --delete dist/ ~/projects/music_api/node_modules/@sudobility/music_codecs/dist/
cp package.json ~/projects/music_api/node_modules/@sudobility/music_codecs/package.json
```

- [ ] **Step 2: Delete the hand-copy**

```bash
cd ~/projects/music_api && git rm src/services/transcription/midi-codec.ts
```

- [ ] **Step 3: Point `settle.ts` at the real codec**

Replace line 19's `import { midiCodec } from './midi-codec';` with:

```ts
import { decodeMidi } from '@sudobility/music_codecs';
```

and line 61's `const file = midiCodec.decode(midi);` with:

```ts
const file = decodeMidi(midi);
```

- [ ] **Step 4: Move `@tonejs/midi` to devDependencies**

`src/routes/transcribe.integration.test.ts` uses it in four places (lines 31, 175, 206, 232) to _build_ MIDI fixtures, which is a legitimate test use. It is no longer needed at runtime.

In `package.json`, move `"@tonejs/midi": "^2.0.28"` from `dependencies` to `devDependencies`, then `bun install`.

- [ ] **Step 5: Verify**

```bash
cd ~/projects/music_api
grep -rn "midi-codec\|midiCodec" src/ || echo "clean"
bun run verify
```

Expected: `clean`, then all green. The transcription integration tests exercise `settle.ts`, so they cover the swap.

- [ ] **Step 6: Commit** (only if asked)

```bash
git add -A && git commit -m "refactor: decode MIDI through music_codecs instead of a server-local copy"
```

---

### Task 11: music_app — update the call sites

**Repo:** `~/projects/music_app`

**Files:**

- Modify: `src/components/dialogs/MidiImportWizard.tsx:147,149`, `src/components/dialogs/DeveloperSettingsDialog.tsx:104`, `src/components/layout/AppLayout.tsx:442,465`, `src/features/projects/DashboardPage.tsx:361`, `src/test/app-services.ts`
- Test: `src/components/layout/AppLayout.test.tsx:263,286`, `src/components/dialogs/MidiImportWizard.test.tsx:16`, `src/features/score-editor/tracker-export.test.ts:52`

**Interfaces:**

- Consumes: `importMidi`, `analyzeMidi`, `exportMidi`, `decodeTracker`, `encodeTracker`, `runBenchmark` — **all through `@sudobility/music_lib`**, which re-exports `music_codecs` wholesale. `package.json` does not change, and `src/__architecture.test.ts`'s declared-exports check keeps passing.

- [ ] **Step 1: Sync the rebuilt libraries**

```bash
for p in music_types music_codecs music_io music_lib; do
  (cd ~/projects/$p && bun run clean && bun run build)
  rsync -a --delete ~/projects/$p/dist/ ~/projects/music_app/node_modules/@sudobility/$p/dist/
  cp ~/projects/$p/package.json ~/projects/music_app/node_modules/@sudobility/$p/package.json
done
rm -rf ~/projects/music_app/node_modules/.vite
```

Do **not** run `bun add`/`bun remove` in `music_app` after this — it reinstalls from the registry and silently discards every package just rsynced in.

- [ ] **Step 2: `MidiImportWizard.tsx`**

Lines 147 and 149 become:

```tsx
        analyze: async (buffer) => analyzeMidi(buffer),
```

```tsx
          importMidi(buffer, options),
```

- [ ] **Step 3: `DeveloperSettingsDialog.tsx`**

Line 104 becomes:

```tsx
const report = runBenchmark(benchmarkSizes);
```

- [ ] **Step 4: `AppLayout.tsx`**

Line 442:

```tsx
const bytes = encodeTracker(module);
```

Line 465:

```tsx
const bytes = exportMidi(target);
```

Line 72's import becomes `import { scoreToTracker, isCleanFit, encodeTracker } from '@sudobility/music_lib';`.

- [ ] **Step 5: `DashboardPage.tsx`**

Line 361 becomes:

```tsx
const mod = decodeTracker(bytes);
```

with `decodeTracker` added to its `@sudobility/music_lib` import.

- [ ] **Step 6: Drop the two fields from the test services**

In `src/test/app-services.ts`, remove `midiCodec` and `modCodec` from whatever object literal supplies `getAppServices().io`. If it spreads `createMusicIo()` from `@sudobility/music_io/mocks`, Task 8 already removed them and nothing is needed here — check and confirm.

- [ ] **Step 7: Update the four test call sites**

```tsx
// AppLayout.test.tsx:263
return decodeMidi(bytes.buffer as ArrayBuffer).tracks.length;
// AppLayout.test.tsx:286
const back = decodeTracker(bytes.buffer as ArrayBuffer);
// MidiImportWizard.test.tsx:16 — delete the line; call encodeMidi/exportMidi directly
// tracker-export.test.ts:52 — delete `const codec = getAppServices().io.modCodec;`
//   and call decodeTracker/encodeTracker directly
```

Import `decodeMidi`, `decodeTracker` and `encodeTracker` from `@sudobility/music_lib` in each.

- [ ] **Step 8: Verify**

```bash
cd ~/projects/music_app
grep -rn "midiCodec\|modCodec" src/ e2e/ || echo "clean"
bun run verify
```

Expected: `clean`, then typecheck + lint + all unit tests + build pass, including `src/__architecture.test.ts`.

- [ ] **Step 9: Run the end-to-end suite**

MIDI import, MIDI export, module import and XM export all cross the boundary this change moved, and the e2e suite is the only place they are exercised against a real browser.

```bash
cd ~/projects/music_app
lsof -ti:5039,8023 | xargs kill -9 2>/dev/null || true
bun run test:e2e
```

Needs a local Postgres `music_test` database and `../music_api`'s dependencies installed. Kill anything on 5039/8023 first — `reuseExistingServer` will otherwise silently attach to a stale server running the old code, which would make this whole verification meaningless.

- [ ] **Step 10: Bump and commit** (only if asked)

```bash
npm version patch --no-git-tag-version
git add -A && git commit -m "refactor: call the score codecs directly instead of through MusicIo"
```

---

### Task 12: Final verification and publish

**Repo:** all six.

- [ ] **Step 1: Verify every repo against the registry-installed packages**

Undo the local rsyncs so nothing passes on a stale local build:

```bash
for p in music_types music_codecs music_io music_lib music_api music_app; do
  echo "=== $p ==="
  (cd ~/projects/$p && bun run verify) || echo "FAILED: $p"
done
```

- [ ] **Step 2: Confirm the four hand-copies are gone**

```bash
cd ~/projects
grep -rln "ToneJsMidiCodec\|withFormatZeroSetupControls" \
  music_types/src music_codecs/src music_io/src music_lib/src music_api/src music_app/src \
  || echo "all four copies deleted"
```

Expected: `all four copies deleted`. This is the change's headline result — say so plainly in the summary rather than implying it.

- [ ] **Step 3: Confirm the rule holds**

```bash
cd ~/projects
echo "--- music_io must hold no score format ---"
ls music_io/src/shared/    # expect: audio, midi (input only), playback, types.ts
echo "--- music_codecs must hold every score format ---"
ls music_codecs/src/       # expect: midi, mod, musicxml, tracker, test, index.ts
echo "--- music_codecs must still have no runtime dependency ---"
node -e "const p=require('./music_codecs/package.json'); console.log('deps', JSON.stringify(p.dependencies), 'peers', JSON.stringify(p.peerDependencies))"
```

Expected: `deps {}`, `peers {"@sudobility/music_types":"^0.11.35"}`.

- [ ] **Step 4: Publish** (only when the user explicitly asks)

Use the `push-all` skill, or `scripts/push_all.sh`, which already encodes the order and the waits: `music_types` → `music_codecs` → `music_drawing` → `music_api` → `music_client` → `music_io` → `music_lib` → `music_app`. The waits matter — a `music_app` build that resolves the previous `music_lib` fails on a symbol that exists only in the new one, and that has shipped before.

Then confirm each publish actually landed with `npm view @sudobility/<pkg> version` rather than trusting the script's log.

---

## Notes for the executor

- **The tracker move is the safe half; the MIDI codec is the risky half.** They are separate tasks on purpose. If something breaks after both have landed, `git bisect` between Task 2 and Task 6 answers which.
- **If a moved tracker test needs a real edit, stop.** A pure move cannot change behaviour. An edit beyond an import path or Prettier formatting means something else is going on, and it should be reported rather than fixed in passing.
- **If the oracle disagrees with our codec, our codec is wrong.** `@tonejs/midi` has years of real files behind it. Fix `decode.ts`/`encode.ts`; do not relax the assertion.
- **Never `bun add` or `bun remove` in `music_app` mid-task** — it reinstalls `node_modules` from the registry and discards every locally rsynced `@sudobility/*` build.
- **Never commit or push unless the user asks in that turn.** Every commit step above is gated on this.
