# Tracker module import: S3M, XM, IT, DSM and MPTM

**Date:** 2026-08-17
**Status:** Approved design, not yet implemented
**Repos touched:** `music_types`, `music_io`, `music_lib`, `music_app`

## Why

`.MOD` import exists and works. The same feature should accept the rest of the
tracker family — S3M, XM, IT, DSM and MPTM — because they are the same kind of
file solving the same problem, and a user with a module does not care which
tracker wrote it.

**Scope is notation import, exactly as `.MOD` is today.** Bytes become an
editable score; sample audio is discarded and playback uses General MIDI
instruments. This is not a module player and does not reproduce the module's
own sound.

## What was verified before designing

The user reported a `.MOD` file failing to import. It was investigated and the
importer was not at fault — the API happened to be down, and the failure was
`Failed to fetch`. Recorded here because the investigation produced the
measurements this design rests on:

| Check                                            | Result                                      |
| ------------------------------------------------ | ------------------------------------------- |
| `readMod` on the reported file                   | 4 channels, 24 patterns, 34 order entries   |
| `readMod` on 8 top-rated modarchive `.mod` files | all decoded                                 |
| `modToScore` on the reported file                | 13 tracks, 136 measures, 5 tempo changes    |
| Resulting score                                  | 1.13 MB JSON, 3113 events — ~100 KB gzipped |
| `validateScore`                                  | **554 warnings**, no errors                 |

Those 554 warnings are all `measure-underfull` and they are a real defect; see
§4.

## Formats

| Format | Tracker          | Notes                                                                                                                                                           |
| ------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD    | ProTracker       | Already supported. Amiga periods, fixed 64 rows, sample-as-instrument.                                                                                          |
| S3M    | Scream Tracker 3 | Parapointer table, packed rows, `A`/`T` for speed/tempo, AdLib instrument slots to skip.                                                                        |
| XM     | FastTracker 2    | Packed rows with a compression bit, instrument layer whose header length is itself a field, `F` split at `0x20`.                                                |
| IT     | Impulse Tracker  | Packed rows with channel-mask run-length, separate instrument and sample tables, `A`/`T`. Instruments may be absent, in which case samples are the instruments. |
| DSM    | DSIK / DSMI      | RIFF-chunked `SONG`/`INST`/`PATT`. The simplest of the five.                                                                                                    |
| MPTM   | OpenMPT          | **IT underneath** — same `IMPM` magic and container, extensions in a trailing block. Rides on the IT decoder plus a detection rule.                             |

## 1. The neutral model (`music_types`)

`ModFile` widens into `TrackerModule`. The shape is driven by exactly what the
six formats differ on:

```ts
export type TrackerFormat = 'mod' | 's3m' | 'xm' | 'it' | 'dsm' | 'mptm';

/** One instrument slot. In MOD/S3M/DSM a sample *is* the instrument; XM, IT and MPTM put a layer above. */
export type TrackerInstrument = { index: number; name: string };

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

export interface TrackerCodec {
  /** Sniffs the format from the bytes and decodes it. Throws on anything unrecognised. */
  decode(bytes: ArrayBuffer): TrackerModule;
}
```

Three deliberate choices:

**Notes are MIDI numbers, not periods.** Only MOD stores Amiga periods. Doing
that conversion inside the MOD decoder puts `periodToMidi` — and the finetune
approximation `music_app/CLAUDE.md` records — behind the boundary instead of
leaking into shared musical code.

**`effect`/`param` are gone.** Today's importer reads exactly one effect: `F`,
for speed and tempo. Notation import has no use for portamento, vibrato or
arpeggio. Since _which_ effect carries tempo is format knowledge, each decoder
normalises to the neutral `speed`/`bpm` fields and nothing downstream branches
on format. The model is therefore smaller than today's, not larger.

**`patternBreak` is new and fixes an existing bug.** `Dxx` ends a pattern
early; today's MOD importer ignores it, so a module using breaks imports with
too many bars, silently. S3M and IT use breaks heavily. Position jumps (`Bxx`)
stay ignored deliberately: honouring them can loop forever and a score has no
way to express it.

## 2. The decoders (`music_io`)

Five decoders under `src/shared/tracker/`, one per format, MPTM sharing IT's.
Shared across web and React Native exactly as `SharedModCodec` is now — nothing
here is platform-bound, and the capability exists for surface consistency.

**Sample payloads are skipped, never decoded.** This is what makes hand-written
decoders tractable. Notation import needs the pattern grid, instrument names
and tempo. IT and XM pack their sample data; S3M addresses it by parapointer.
In every case the headers give a length or an offset, so the decoder seeks past
the audio without implementing a single decompressor — removing the largest and
riskiest part of each format.

**Detection is by magic bytes, not file extension**, so a mis-named file still
imports and an unrecognised one fails naming what it found:

| Format    | Magic                                                                                |
| --------- | ------------------------------------------------------------------------------------ |
| MOD       | `M.K.` / `M!K!` / `4CHN` / `6CHN` / `8CHN` / `FLT4` / `CD81` / `OKTA` at offset 1080 |
| S3M       | `SCRM` at offset 44                                                                  |
| XM        | `Extended Module: ` at offset 0                                                      |
| IT / MPTM | `IMPM` at offset 0; MPTM distinguished by OpenMPT's tracker-version field            |
| DSM       | `RIFF` at 0 with `DSMF` at 8                                                         |

## 3. Score mapping (`music_lib`)

`modToScore` becomes `trackerToScore`, keeping its musical decisions:

- **Group by instrument, not channel**, so all the bass lands on one track
  wherever it was played from. A track is therefore not always one line: two
  channels on one instrument at the same row become separate **voices**.
- **Flatten the order list.** A pattern played three times becomes three sets of
  measures; a score has no "repeat this pattern", and inventing one would trade
  an editable score for a faithful one. Now honours `patternBreak`.

and gaining three:

- **Note-off ends a note.** MOD has no note-off, so a note runs until its
  channel replays. The other five say so explicitly, which gives accurate
  durations — and makes "runs until replayed" the MOD-only fallback it always
  was.
- **Gaps fill with rests** (§4).
- **Tempo** comes from the neutral `speed`/`bpm` fields through the existing
  `effectiveBpm` arithmetic, unchanged and with no format branches.

## 4. The defect this fixes

`modToScore` does not pad gaps with rests. Measured on the reported file: 554
`measure-underfull` warnings, e.g. _"Voice 1 in measure 3 covers 1200 ticks,
short of the measure's 1920"_. Those bars render short and wrong.

It does not block import, which is why it survived. Building five more
importers on the same mapping would multiply it, so `trackerToScore` fills every
gap — before a note, between notes, and after the last note in a measure — so
that every voice covers its measure exactly.

## 5. Known limitations, stated rather than discovered

- **MPTM custom tunings.** MPTM's headline feature is non-12-TET tuning
  definitions, and this app's `Pitch` model is twelve-tone. Such a file imports
  with notes in the right rhythm at approximately the right pitch, and the
  import dialog says so.
- **MPTM multiple sequences.** MPTM can hold several order lists where IT has
  one. The first is imported, and the dialog says which.
- **Position jumps are ignored** (§1).
- **MOD finetune.** `periodToMidi` computes from a reference period rather than
  ProTracker's table, which finetune shifts, so a real module can land a note or
  two differently than a tracker would show. Unchanged, and now confined to the
  MOD decoder.

## 6. App surface (`music_app`)

No new UI. Import → Module widens `accept` to
`.mod,.s3m,.xm,.it,.dsm,.mptm` and the dialog copy stops naming ProTracker
specifically. The one-step import stands: a tracker module states every note and
instrument outright, so there is nothing to estimate and nothing to confirm.

## 7. Testing

Two layers.

**Hand-built buffers, per format**, for the byte-level rules — packed-row
unpacking, parapointer following, instrument-header length handling, chunk
walking — as `src/shared/mod/read.test.ts` does today. These are deterministic
and are what CI relies on.

**Real modules, committed as fixtures.** A small set per format under
`music_io/src/shared/tracker/fixtures/`, chosen as the smallest file that
exercises each format, with a `README.md` beside them recording each file's
modarchive module id, title and author so provenance is traceable. Acceptance
tests assert each decodes and produces a score with plausible structure — track
count, measure count, non-zero notes, and **zero validation errors**.

The eight top-rated `.mod` files already downloaded during investigation are the
starting corpus for MOD.

**Note on provenance:** these are their authors' copyright, downloadable from
modarchive but not obviously licensed for redistribution. Committing them was a
deliberate decision by the repository owner; the README records where each came
from so it can be revisited.

## 8. Migration order

1. **`TrackerModule` in `music_types`**, alongside `ModFile` — both exported
   while the migration runs.
2. **MOD decoder produces `TrackerModule`**, period conversion moving in.
   `trackerToScore` written against it, with the rest-filling fix and note-off
   support. Everything still passes; `ModFile` and `modToScore` are deleted.
3. **DSM**, the simplest, proving the second decoder fits the model without
   changing it.
4. **S3M**, the first packed-row format.
5. **XM**.
6. **IT**, then **MPTM** as a detection rule on top of it.
7. **App surface** and docs.

Steps 3-6 are independent of one another; each is a decoder plus its fixtures.
If a format proves intractable, the others still ship.

## 9. Documentation to update

- `music_app/CLAUDE.md`'s `.MOD` import gotcha — it describes grouping by
  sample, the flattened order list and the finetune limitation, all of which
  generalise or move.
- `music_io/CLAUDE.md` — the shared-codec note.
- `music_app/docs/spec.md` — the import list.

## 10. Rejected alternatives

**Per-format importers.** Five copies of the grouping, voicing and tempo logic.
The musical decisions are the valuable part and they are identical.

**`libopenmpt` via WASM.** Decodes ~40 formats and would sidestep decades of
real-world file variance, which is a genuine argument. Rejected for now: another
~1.5 MB WASM in a bundle already carrying a 23 MB soundfont, a player-shaped API
queried cell by cell, and it makes parsing platform-bound when nothing about it
is. It stays available as a swap behind `TrackerCodec` if the hand-written
decoders prove unreliable against the fixture corpus — which is a point in this
design's favour, not against it.
