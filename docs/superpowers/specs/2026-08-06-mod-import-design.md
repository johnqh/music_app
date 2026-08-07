# .MOD import

**Status:** draft 2026-08-06
**Goal:** open an Amiga tracker module as an editable score.

Last of the three format projects. Import only — writing `.MOD` requires embedding sample data, which is a different feature and a much larger one.

## Why this is the easy one

Unlike audio, a `.MOD` already contains notes. There is no signal processing and no estimation: every pitch, every row, every instrument change is stated in the file. That makes it deterministic, and testable the way the MIDI codec is — a hand-built buffer with a known answer.

The work is all in the mapping, and there are exactly three decisions.

## Where it lives

A **`ModCodec` capability** on `MusicIo`, reached as `getAppServices().io.modCodec`, matching how MIDI and MusicXML are already reached. Consistency of surface is the point: the app should not have one format that arrives by a different route.

Nothing about parsing is platform-bound, so the three implementations **delegate to one platform-free module** rather than duplicating it — the same shape as `shared/audio/wav.ts`, which the web, RN and mock audio codecs all share. One implementation, one set of tests, one consistent surface.

## Channels become tracks by instrument

A MOD has 4 (sometimes 8 or more) monophonic channels and up to 31 sampled instruments. Any channel may play any sample and may switch mid-song.

**Notes are grouped by sample, not by channel.** All the bass ends up on one track wherever it was played from, which is what makes the result editable as music rather than as a tracker dump.

The consequence, stated because it shapes the implementation: two channels playing the same sample at the same moment produce **simultaneous notes on one track**. The score model already houses that — separate voices within the measure, the same mechanism two-hand piano writing uses. A sample-grouped track is therefore not always a single line, and the importer must allocate voices rather than assume one.

Track names come from the sample names in the file, which are free text and often decorative or empty; an empty one falls back to `Sample N`.

## Timing honours both knobs

MOD timing has two interacting controls:

- **Speed** — ticks per row, default 6. Fewer ticks means shorter rows.
- **Tempo** — BPM, default 125.

Either can change mid-song via effect commands, and speed changes are the more common of the two — fills and endings routinely use them.

**Both are honoured**, producing a real multi-event `TempoMap`:

```
row 0    speed 6, tempo 125  → 125 bpm
row 32   speed 3             → 250 bpm
row 64   tempo 100           → 200 bpm
```

Each change emits a tempo event at that row's tick. The model already supports a multi-event tempo map, so nothing new is required — this is a mapping problem, not a modelling one.

Row length in ticks is fixed (a row is a subdivision of the beat); it is the _tempo_ that moves. That is what keeps the score's grid regular while playback matches the original.

## Patterns and the order list

A MOD stores patterns of 64 rows and an order list that plays them, often repeating one several times. The order list is **flattened**: a pattern played three times becomes three sets of measures. A score has no concept of "repeat this pattern", and inventing one to preserve the file's structure would trade an editable score for a faithful one.

## Testing

- A hand-built buffer with one note on one channel yields one note at the right pitch — the foundation every other test rests on.
- Period values map to the correct MIDI pitches across the MOD period table.
- Two channels using the same sample land on **one track, in different voices**, at the same tick.
- A channel that switches sample mid-song contributes to **two** tracks.
- A speed change and a tempo change each emit a tempo event, with the effective BPM computed from both.
- A repeated pattern in the order list produces its measures once per repetition.
- An empty sample name falls back to `Sample N`.
- A file that is not a MOD is rejected rather than producing a garbage score.
- **e2e** — import a small generated `.MOD` and see tracks and notes appear.

## Out of scope

- **Export.** Writing `.MOD` means embedding samples; a separate, larger feature.
- **The samples themselves.** Notes are mapped to General MIDI voices by name where possible and a default otherwise. Playing back the original 8-bit samples is a sampler feature, not an import feature.
- **Effects beyond speed and tempo** — no arpeggio, portamento, vibrato or volume slides. They are performance detail with no representation in the score model.
- **Formats beyond 4-channel ProTracker and its common 8-channel variants.** XM, S3M and IT are different formats wearing a similar hat.
