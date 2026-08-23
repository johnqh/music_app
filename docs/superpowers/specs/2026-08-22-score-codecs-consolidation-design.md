# Score codecs consolidation: vector formats to music_codecs, raster formats to music_io

**Date:** 2026-08-22
**Status:** Approved design, not yet implemented
**Repos touched:** music_types, music_codecs, music_io, music_lib, music_api, music_app

## The rule

One sentence decides where every file format lives:

> **A format that carries notes belongs to `music_codecs`. A format that carries
> samples belongs to `music_io`.**

Score formats — MIDI, MusicXML, and the tracker modules — describe music
symbolically. Reading them is byte arithmetic against a published spec: no
`AudioContext`, no DOM, no filesystem. They run identically on the frontend, on
React Native, and on the server, so they belong in the package both sides can
depend on.

Audio formats — WAV, MP3 — carry sampled sound. Encoding and decoding them
needs a real audio context, so they are platform capabilities and stay behind
the `MusicIo` seam with playback and file export.

## The problem

The rule is already the intent — `music_codecs`' own header comment says every
file format lives there — but the boundary was drawn in the wrong place. It
runs _through_ MIDI rather than around it:

| Step                                                                  | Today                                      |
| --------------------------------------------------------------------- | ------------------------------------------ |
| `ArrayBuffer` → `MidiFile` (chunks, VLQ, running status, meta events) | **music_io** `shared/midi/codec.tonejs.ts` |
| `MidiFile` → `Score` (quantize, measures, key/grid detection)         | music_codecs `midi/import.ts`              |
| `Score` → `MidiFile` (expression, tempo map, ties)                    | music_codecs `midi/export.ts`              |
| `MidiFile` → `Uint8Array`                                             | **music_io**                               |

The seam is three lines of call site — `import.ts:627`, `export.ts:127`,
`analyze.ts:113`, each handing off to an injected `MidiCodec`. Behind those
three lines sits ~3,250 lines in `music_io` that has no business being there.

Tracker is the same shape and more lopsided: `music_codecs` holds
`trackerToScore` and `scoreToTracker` — the musical half — while `music_io`
holds all five format readers, the XM writer, the RIFF container, the
ProTracker and S3M effect tables, and the Amiga period math.

### What the misplacement cost

**`ToneJsMidiCodec` exists four times.** `music_io/src/shared/midi/codec.tonejs.ts`,
`music_codecs/src/test/platform.ts`, `music_lib/src/test/platform.ts`, and
`music_api/src/services/transcription/midi-codec.ts`. Each carries its own copy
of the same `@tonejs/midi` CommonJS-namespace workaround, comment included.

They exist because `music_codecs/src/__architecture.test.ts` bans
`@tonejs/midi` from the package's source — correctly, since `music_api` and
`music_lib` both consume `music_codecs` and neither may reach the other. With
the only real codec stranded in `music_io`, every consumer that needed one
hand-wrote it. `music_api`'s copy is decode-only: its `encode` throws
`'encoding is not supported on the server'`, with a comment pointing at
`music_io` as the place that can do it.

**Nothing about these codecs is platform-bound, and the code says so.**
`music_io/src/web/index.ts` and `src/rn/index.ts` construct the _same_
`ToneJsMidiCodec` and `SharedTrackerCodec`. `mod/codec.ts`'s own header reads
"One implementation, not three: nothing about reading a module is
platform-bound." A capability with one implementation across every platform is
not a capability.

**`music_app` never declares `@tonejs/midi`.** It is a peer dependency of
`music_io`, satisfied today only by hoisting. A stricter installer breaks it.

## Decisions

### 1. The injection seam goes away

`music_codecs` exports concrete functions. `midiCodec` and `modCodec` come off
the `MusicIo` type, and the `MidiCodec` and `TrackerCodec` interfaces leave
`music_types` — nothing implements them by injection any more.

The alternative was keeping the seam with `music_io` re-exporting
`music_codecs`' classes. Rejected: it preserves the `getAppServices().io.midiCodec`
threading and the four duplicate copies, which are the actual cost. The seam was
justified by "a different codec can be dropped in behind it", and that has never
happened on any platform in the life of the codebase.

A side benefit: `music_io/src/shared/types.ts` currently carries the comment
_"Named `modCodec` still, for now: renaming it reaches into music_app and
belongs with the change that widens the accepted extensions."_ Deleting the
field retires that debt instead of paying it.

### 2. The SMF byte codec is hand-written; `@tonejs/midi` becomes a test oracle

`music_codecs` gains no runtime dependency. `__architecture.test.ts` keeps
asserting `dependencies: []` and keeps `@tonejs/midi` on its `FORBIDDEN` list
for `src/`, exactly as written today.

This is affordable because the library supplies very little that is not plain
spec work. `MidiFile` is 55 lines of plain data; everything else `@tonejs/midi`
computes is discarded at the adapter boundary. The used surface is ~25 members:
chunk parsing, variable-length quantities, running status, note-on/off pairing,
and four meta events — tempo (`FF 51`), time signature (`FF 58`), track name
(`FF 03`), end-of-track (`FF 2F`).

Two things that looked expensive are not:

- **GM instrument names** are already in `music_types` as `gmInstrument(n).name`,
  which `music_codecs` already depends on.
- **Format-0 splitting** is the one thing `@tonejs/midi` does _badly_.
  `withFormatZeroSetupControls` — 25 lines, replicated in all four adapters —
  exists solely to patch up tick-0 CC7/CC10 values the library strands on a
  phantom setup track. Splitting format 0 by channel ourselves deletes that
  workaround rather than inheriting it a fifth time.

Scale for comparison: this is less intricate than `it.ts`, which `music_codecs`
will already own, with its stateful per-channel mask-and-value packing.

**The real risk is fixtures, not the library.** There is not one `.mid` file
anywhere in the family. Every MIDI test that crosses bytes round-trips through the codec under
test, so a codec that is internally consistent but spec-wrong passes all of them
silently. (The MIDI suite is 80 cases, but `grid-detection`, `key-detection`,
`measures` and `import-timing` operate on `MidiFile` objects and never see a
byte — the exposure is `import`, `export`, `analyze` and `roundtrip`.)

The mitigation is what makes this decision safe: keep `@tonejs/midi` as a
**devDependency** — `music_codecs` already has it as one, and the architecture
guard already exempts `src/test/` — and use it as an **independent oracle**.
Bytes our encoder writes must decode correctly through `@tonejs/midi`; bytes
`@tonejs/midi` writes must decode correctly through ours. That is real
validation against a mature implementation with zero runtime cost.

## What moves

### To `music_codecs`

MIDI, into `src/midi/`:

- `codec.tonejs.ts` → replaced by a hand-written `codec.ts` (`decodeMidi` / `encodeMidi`)

Tracker, into a new `src/tracker/` beside the existing `src/mod/`:

- From `music_io/src/shared/mod/`: `read.ts`, `period.ts`, `codec.ts`, `fixture.ts`
- From `music_io/src/shared/tracker/`: `dsm.ts`, `it.ts`, `s3m.ts`, `xm.ts`,
  `xm-write.ts`, `riff.ts`, `protracker-effects.ts`, `s3m-effects.ts`, and the
  four `*-fixture.ts` builders

All accompanying `*.test.ts` files move with them, including
`tracker/acceptance.test.ts`. These are a **pure move**: their only imports are
`@sudobility/music_types` and each other. Import paths change and nothing else.

`src/mod/` keeps the score-model half it already has (`import.ts`, `export.ts`,
`fill.ts`, `limits.ts`, `timing.ts`, `types.ts`); `src/tracker/` holds the byte
half. `mod/types.ts`'s comment "The shape `music_io`'s `TrackerCodec.decode`
produces" is updated to point at its new neighbour.

### Staying in `music_io`

Unchanged, and correctly placed:

- `shared/audio/mp3.ts`, `shared/audio/wav.ts` — sampled audio
- `web/audio/*`, `rn/audio/*`, `rn/audio-codec.ts` — audio codecs and offline renderers
- `web/playback/*`, `rn/playback/*`, `shared/playback/*` — the engines
- `web/file/*`, `rn/file/*` — file export
- `web/midi/web-midi-input.ts`, `shared/midi/unsupported-midi-input.ts` —
  **MIDI input is a device, not a file format.** It stays.
- `shared/playback/midi.ts` — `midiToHertz` / `normalizeVelocity`, playback math

### `XmlParser` stays a platform capability

Deliberately unchanged. Unlike MIDI and tracker, the XML-to-DOM step _is_
platform-bound and has two genuinely different implementations: `DOMParser` on
web, `fast-xml-parser` on React Native. The MusicXML _semantics_ already live in
`music_codecs`; only the parse primitive is injected, and that is the correct
split. Moving it would mean adopting `fast-xml-parser` as a runtime dependency
everywhere and giving up the browser's native parser — plus its correct handling
of mixed content, which the RN adapter documents as a known loss.

## New `music_codecs` public API

```ts
// Bytes ↔ neutral model (new)
export function decodeMidi(data: ArrayBuffer): MidiFile;
export function encodeMidi(file: MidiFile): Uint8Array;
export function decodeTracker(bytes: ArrayBuffer): TrackerModule; // magic-byte dispatch
export function encodeTracker(module: TrackerModule): ArrayBuffer; // XM only; throws by name

// Bytes ↔ Score (codec parameter dropped)
export function importMidi(data: ArrayBuffer, options: MidiImportOptions): Score;
export function analyzeMidi(data: ArrayBuffer): MidiSummary;
export function exportMidi(score: Score): Uint8Array;
```

`importMidiFile(file, options)` and `analyzeMidiFile(file)` keep their current
signatures. They stay because they are the worker-friendly entry points —
`MidiFile` is structured-cloneable where a codec instance is not, which
`import.ts:514` already documents.

`decodeTracker` keeps the magic-byte dispatch verbatim from
`SharedTrackerCodec.decode`, including its ordering: RIFF/DSMF, then IMPM, then
SCRM at offset 44, then XM's 17-character signature, with MOD as the fallback
because its magic sits at offset 1080 and `readMod` validates it.

## Per-repo changes

### music_types

- Delete the `MidiCodec` interface (`src/platform/midi.ts`) and the
  `TrackerCodec` interface (`src/platform/mod.ts`). The **model** types —
  `MidiFile`, `MidiNote`, `MidiTrackData`, `MidiControlChange`,
  `MidiTempoEvent`, `MidiTimeSignatureEvent`, `TrackerModule`, `TrackerCell`,
  `TrackerFormat`, `TrackerInstrument` — all stay.
- Move `midi.ts` and `mod.ts` from `src/platform/` to a new `src/formats/`.
  A folder named `platform` holding types that are not platform-shaped is the
  same mislabeling this change exists to fix. `src/index.ts` re-exports flat, so
  no consumer import changes.
- `src/platform/index.ts` and `platform.test.ts` updated accordingly.

### music_codecs

- Receive the files above; add `src/tracker/`.
- Write `src/midi/codec.ts` (`decodeMidi` / `encodeMidi`) and its tests.
- Drop the `codec` parameter from `importMidi`, `analyzeMidi`, `exportMidi`.
- Export the four new byte-level functions from `src/index.ts`; update the
  header comment, which currently says byte work "belongs to
  `@sudobility/music_io`, which is injected".
- `src/test/platform.ts`: delete `ToneJsMidiCodec` and `testMidiCodec` —
  the real one now lives in `src/`. Keep `testXmlParser`; XML is still injected.
  Rename the file to reflect that it is now XML-only scaffolding.
- `__architecture.test.ts`: `FORBIDDEN` and the `dependencies: []` assertion are
  **unchanged**. Add a test asserting `@tonejs/midi` appears in no
  shipped source file and stays a devDependency — the rule that keeps decision 2
  honest over time. (It is confined to `*.test.ts`, not to `src/test/`: the
  oracle lives beside the codec it checks, at `src/midi/oracle.test.ts`.)

### music_io

- Delete `shared/mod/`, `shared/tracker/`, `shared/midi/codec.tonejs.ts` and its test.
- `shared/types.ts`: remove `midiCodec` and `modCodec` from `MusicIo`, and the
  `modCodec` naming-debt comment with them.
- `web/index.ts`, `rn/index.ts`, `mocks/index.ts`: drop the two fields and their
  imports and re-exports (`ToneJsMidiCodec` is re-exported from both entries).
- `contract/platform-contract.ts`: delete the `midiCodec`/`modCodec` assertions
  at lines 64, 67, 74, 79, 121, 140. The MOD-decode and MIDI-round-trip
  assertions move to `music_codecs`, where the code now is.
- `package.json`: drop the `@tonejs/midi` peer dependency and its
  `devDependencies` entry. Update `description`, which advertises "MIDI codecs".
- Update `CLAUDE.md`'s charter.

### music_lib

- `src/test/platform.ts`: delete `ToneJsMidiCodec` and `testMidiCodec`
  (93 lines, lines 113-205). Keep `testXmlParser`.
- `src/services/perf/benchmark.ts`: drop the `MidiCodec` parameter from both
  functions at lines 118 and 199; call `encodeMidi`/`decodeMidi` directly.
- `benchmark.test.ts`: drop `testMidiCodec()`.
- Drop `@tonejs/midi` from `devDependencies`.
- `src/index.ts` already does `export * from '@sudobility/music_codecs'`, so
  `music_app` picks the new functions up with no new dependency.

### music_api

- **Delete `src/services/transcription/midi-codec.ts` entirely.**
- `settle.ts:61`: `midiCodec.decode(midi)` → `decodeMidi(midi)` from
  `@sudobility/music_codecs`.
- Drop `@tonejs/midi` from `dependencies`. `transcribe.integration.test.ts`
  imports it in four places as a test fixture builder; move it to
  `devDependencies` rather than removing it.

### music_app

Seven production call sites and four test ones:

| File                                                                                      | Change                              |
| ----------------------------------------------------------------------------------------- | ----------------------------------- |
| `dialogs/MidiImportWizard.tsx:147,149`                                                    | drop the codec argument             |
| `dialogs/DeveloperSettingsDialog.tsx:104`                                                 | `runBenchmark(benchmarkSizes)`      |
| `layout/AppLayout.tsx:442`                                                                | `encodeTracker(module)`             |
| `layout/AppLayout.tsx:465`                                                                | `exportMidi(target)`                |
| `projects/DashboardPage.tsx:361`                                                          | `decodeTracker(bytes)`              |
| `AppLayout.test.tsx:263,286`, `MidiImportWizard.test.tsx:16`, `tracker-export.test.ts:52` | import from `@sudobility/music_lib` |

All new imports come through `@sudobility/music_lib`'s re-export, so
`package.json` is unchanged and `__architecture.test.ts`'s declared-exports check
still passes. `src/test/app-services.ts` loses the two fields.

## Testing

1. **The moved tracker tests must pass unmodified** apart from import paths.
   That is the definition of a pure move, and any other edit to them is a signal
   the move was not clean.
2. **The new SMF codec is oracle-tested** against `@tonejs/midi` in both
   directions, plus the existing byte-crossing tests, which now exercise
   shipped code rather than test scaffolding.
3. **Format 0 gets its own tests.** It is the one place behaviour deliberately
   changes: `withFormatZeroSetupControls` disappears, and a format-0 file must
   import with its CC7/CC10 mix intact by construction instead of by patch-up.
   This is the highest-risk item in the change and needs a test that fails
   against the old behaviour.
4. **Contract coverage moves, it does not vanish.** The `music_io` platform
   contract's MOD-decode and MIDI-round-trip assertions are re-homed in
   `music_codecs`.
5. `bun run verify` green in all six repos, then `bun run test:e2e` in
   `music_app` — MIDI import, MIDI export, module import and XM export all cross
   this boundary.

## Risks

| Risk                                                   | Mitigation                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand-written SMF is spec-wrong but self-consistent     | The `@tonejs/midi` oracle, in both directions. This is the whole reason it stays a devDependency.                                                                                     |
| Format-0 behaviour change is a silent regression       | Dedicated tests; it is called out as the one intentional behaviour change rather than folded into the move.                                                                           |
| Running status / VLQ edge cases                        | Oracle round-trips over generated files that exercise both; these are the classic SMF failure points.                                                                                 |
| `music_app` breaks on a version skew mid-publish       | Follow `scripts/push_all.sh` order — `music_types` → `music_codecs` → `music_drawing` → `music_api` → `music_client` → `music_io` → `music_lib` → `music_app` — and honour its waits. |
| A stale `dist` masks the change during cross-repo work | `bun run clean && bun run build` before any `rsync` into `node_modules`, and delete `node_modules/.vite`. Both are documented gotchas that have each cost a debugging cycle.          |

## Order of work

Staged so each step is independently verifiable:

1. **music_types** — remove the two interfaces, move the two files to `src/formats/`.
2. **music_codecs, tracker** — pure move of 28 files. Tests pass with only
   import-path edits. Add `decodeTracker` / `encodeTracker`.
3. **music_codecs, MIDI** — write `codec.ts` and the oracle tests. Land this
   with `@tonejs/midi` still present in `music_io` so the two can be compared
   directly during development.
4. **music_codecs, API** — drop the `codec` parameters; export everything.
5. **music_io** — delete the moved code and the two `MusicIo` fields.
6. **music_lib, music_api, music_app** — update call sites; delete the two
   remaining hand-copies.
7. Publish in `push_all.sh` order.

Steps 2 and 3 are separable on purpose: the tracker move is zero-risk and the
MIDI rewrite is not, so a bug after both have landed should not be ambiguous
about which caused it.

## Out of scope

- Moving `XmlParser` into `music_codecs` — see above; it stays injected.
- Widening tracker import beyond the six formats already accepted.
- Writers for MOD, S3M, IT or MPTM. XM stays the only format written, and
  `encodeTracker` keeps throwing by name for the rest.
- Renaming `music_io`'s remaining audio capabilities.
