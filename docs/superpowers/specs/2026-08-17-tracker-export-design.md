# Tracker module export: MOD, S3M, XM and IT

**Date:** 2026-08-17
**Status:** Approved design, not yet implemented
**Repos touched:** `music_types`, `music_io`, `music_lib`, `music_app`
**Depends on:** [tracker import](./2026-08-17-tracker-formats-design.md) — shares its `TrackerModule` model

## The rule this follows

Export formats divide in two, and the division is already in the code:

- **Notes formats** — MIDI, MusicXML, Project JSON, and now the tracker
  modules. The score's vector data is written directly. **Nothing is rendered.**
- **Audio formats** — WAV, MP3. The score is rendered through `renderOffline`
  and encoded. Essentially a recording of playback.

`handleExportAudio` already does the second; `handleExportMidi` /
`handleExportMusicXml` / `handleExportProjectJson` already do the first. Modules
join the first group, so this adds writers rather than architecture.

## 1. What gets written, and what does not

**No sample data.** A module is a notes format under the rule above, so nothing
is rendered into it. A module with zero-length sample slots is structurally
valid and loads in any tracker.

**Sample slots are named after their GM instrument.** "Acoustic Grand Piano",
"Fretless Bass". Free — every format has a name field — and it means a tracker
user opening the file sees what each slot is for and can drop their own samples
straight in.

**The file is silent until someone adds samples, and the UI says so.** This is
the honest cost of notes-only export. Unstated, it reads as a broken export and
generates a bug report.

`music_app/CLAUDE.md` currently says _"Import only: writing `.MOD` means
embedding sample data."_ That reasoning is what this design overturns: writing a
module means embedding sample data **only if you want it to make sound**, and
under the notes/audio split we explicitly do not.

## 2. The three lossy mappings

None of these exist on the import side. All three are why §4's fit report is
part of the feature rather than a nicety.

**Score to row grid.** Tracker rows are a fixed subdivision. The export picks
rows-per-beat: 4 gives sixteenth resolution and cannot express triplets; 6
expresses triplets and misaligns some straight subdivisions. Default 4.
Anything shorter than one row is lost.

**Voices to channels.** A track with three simultaneous voices needs three
channels; the total needed is the sum of each track's maximum voice count.
That can exceed the format's limit.

**Note range.** ProTracker covers three octaves, C-1 to B-3. A piano part does
not fit. Out-of-range notes are clamped to the nearest available octave.

## 3. Architecture

Mirrors import exactly, and reuses its model.

```
score --( music_lib )--> TrackerModule + FitReport --( music_io )--> bytes
        scoreToTracker                                trackerCodec.encode
```

- **`scoreToTracker(score, options)` in `music_lib`** does the musical work:
  quantise to the row grid, allocate voices to channels, clamp pitches, build
  the order list and patterns, derive speed/tempo from the `TempoMap`. Returns
  `{ module, report }`. Pure, no bytes, testable without the platform layer —
  the same split `modToScore` has.
- **`TrackerCodec.encode(module, format)` in `music_io`** turns the neutral
  `TrackerModule` into that format's bytes. One writer per format, sharing the
  model the decoders already produce.

`options` carries `{ format, rowsPerBeat, scope }` — the format matters to
`scoreToTracker` because the limits differ per format and the report has to
describe the target.

```ts
export type TrackerFitReport = {
  /** Notes moved into range, with how far. */
  clampedNotes: number;
  /** Voices that did not fit the format's channel count. */
  droppedVoices: number;
  /** Notes shorter than one row, lost to the grid. */
  droppedShortNotes: number;
  /** Notes whose start moved to land on a row. */
  quantisedNotes: number;
};
```

## 4. The flow, and why the order matters

1. **Scope dialog** (existing `ExportScopeDialog`): all tracks, or visible only.
2. **Compute** `scoreToTracker` against the chosen scope.
3. **If the report is empty, write the file.** This is the common case for XM
   and IT and must not cost a click.
4. **If anything was lost, show it and let the user choose** — continue or
   cancel — naming the numbers: "12 notes outside ProTracker's range were
   clamped. 2 voices did not fit in 4 channels."

Scope comes **first** because the fit depends on it: exporting visible tracks
only may bring a score within MOD's four channels when all tracks do not.
Computing the report before scope would describe the wrong thing.

## 5. Formats and their limits

| Target | Channels | Instruments | Note range | Notes                                                  |
| ------ | -------- | ----------- | ---------- | ------------------------------------------------------ |
| MOD    | 4        | 31          | 3 octaves  | Iconic and by far the most lossy.                      |
| S3M    | 32       | 99          | 8 octaves  | Fine; XM and IT dominate it.                           |
| XM     | 32       | 128         | 8 octaves  | Best target — comfortable and universally read.        |
| IT     | 64       | 99          | 10 octaves | Also comfortable; read natively by OpenMPT and Schism. |

**DSM and MPTM are import-only.** Nothing reads DSM that does not read a better
format, and OpenMPT reads IT natively so writing MPTM buys nothing. Reading an
obscure format is worth it; writing one is not.

## 6. App surface

Four more entries in the existing export menu, grouped under the notes formats
beside MIDI and MusicXML. `handleExportModule(format)` follows
`handleExportMidi`'s shape, with the fit dialog between scope and write.

## 7. Testing

**Round-trip through our own importer.** Export a score, decode it with the
matching decoder from the import work, and compare: same note count, same
pitches (modulo documented clamping), same instrument grouping. This is the
strongest automated check available and it costs nothing, because the decoders
exist.

**Fit reporting, per limit.** A score with a note below C-1 reports a clamp; a
score needing five channels in MOD reports a dropped voice; a triplet at 4
rows-per-beat reports quantisation. Each asserted directly against
`scoreToTracker`, no bytes involved.

**Byte-level structure**, per format: the header fields, sample-slot names and
pattern packing a tracker requires, asserted against a hand-built expectation.

**By hand, once per format:** open an exported file in a real tracker (OpenMPT
reads all four) and confirm the notes appear where they should. No automated
test substitutes for this, and it is the check that catches a header field that
is structurally valid but wrong.

## 8. Documentation to update

- `music_app/CLAUDE.md` — the "Import only" rule (§1), and the export list.
- `music_app/docs/spec.md` — export formats.

## 9. Rejected alternatives

**Rendering samples from the soundfont.** Technically available — `renderOffline`
and a 23 MB soundfont are already here — and it would make exported modules
sound like the score. Rejected because it violates the notes/audio split: a
notes format carries notes, and someone who wants audio exports WAV or MP3.

**Refusing to export when a score does not fit.** Never produces a misleading
file, but a score one note out of range could not be exported at all.

**Exporting silently and lossily.** Produces a file that quietly is not the
music, which is the failure mode this codebase consistently designs against.
