# Audio import and export

**Status:** draft 2026-08-05
**Goal:** export a score as `.wav` or `.mp3`, and turn a recording of a single melodic line — sung, hummed, or played — back into notes.

First of the two format projects; `.MOD` import follows.

## The two halves are not equally hard

**Export is mechanical.** The app already synthesises every General MIDI family through Tone.js. Rendering offline to a buffer and encoding it is plumbing, and the result sounds exactly like playback because it _is_ playback.

**Import is signal processing**, and only tractable because we scoped it to one line at a time. Monophonic pitch detection is a solved problem; polyphonic transcription is a research area, and this feature deliberately does not attempt it.

## What import handles, and what it does not

|                                           |                                     |
| ----------------------------------------- | ----------------------------------- |
| humming, singing, whistling               | ✅                                  |
| a solo flute, trumpet, single-note guitar | ✅                                  |
| solo piano, or anything with chords       | ❌ follows the loudest line at best |
| a full mix                                | ❌ not attempted                    |

**Voice-to-tone is not a separate feature.** Monophonic detection does not care what made the sound, so a vocal file transcribes exactly like a flute one. The option asked for is what the importer already is.

Import states this in the dialog rather than letting people discover it by importing a band recording and getting nonsense.

## The pipeline

```
file → decode → pitch track → segment → detect tempo → quantise → notes
```

1. **Decode** `.wav`, `.mp3`, `.mpa` to PCM samples. `.mpa` is MPEG audio — the same decode path as `.mp3`, free once that works.
2. **Pitch track** with autocorrelation (YIN), producing a fundamental frequency and a confidence per frame.
3. **Segment** into notes: a run of frames at a stable pitch with usable confidence is one note; a confidence collapse, a silence, or a pitch jump beyond a semitone ends it. Frames below a confidence floor are silence, not notes — this is what stops breath noise becoming a run of grace notes.
4. **Detect tempo** from the note onsets (see below).
5. **Quantise** with `music_lib`'s existing quantiser. This feature adds no second implementation of "put this on a grid".
6. **Notes** land on a **new track**, named after the file, so nothing existing is ever overwritten by an import.

## Tempo

**Detected from the audio.** Inter-onset intervals are histogrammed and the strongest periodicity, folded into a musical range (roughly 50–200 bpm), is the tempo.

The detected value is **shown in the import dialog and can be corrected before committing.** Detection still drives it — the field arrives filled in, and accepting it is one click. The escape exists because onset-based detection is weakest on exactly the loose, unmetered humming people try first, and re-humming a melody is more annoying than typing a number.

## The platform boundary

Decoding and encoding audio are platform-bound — Web Audio on the web, something else entirely on React Native — so per this family's architecture they are an interface in `music_types`, implemented in `music_io`, alongside `midiCodec` and `xmlParser`:

```ts
export interface AudioCodec {
  /** Decode .wav/.mp3/.mpa to mono PCM at a known sample rate. */
  decode(bytes: ArrayBuffer): Promise<{ samples: Float32Array; sampleRate: number }>;
  encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer;
  encodeMp3(samples: Float32Array, sampleRate: number): ArrayBuffer;
}
```

**The analysis itself is not platform-bound** and belongs in `music_lib` — pitch tracking, segmentation, tempo detection and the mapping to notes are pure functions over a `Float32Array`, testable with synthesised input and no browser at all.

Web decoding uses `AudioContext.decodeAudioData`, which handles wav and mp3 natively — no mp3 decoder to bundle. **Encoding mp3 does need one** (`lamejs`, ~100KB); wav is a header and the samples.

## Export

Renders offline through the same instruments playback uses, so what you export is what you heard. Choice of `.wav` (exact, large) or `.mp3` (small, lossy). Goes through `fileExporter`, like every other export.

Exporting respects mute and solo, because those are part of how the score currently sounds.

## Testing

- **Synthesised input, known answer**: a generated 440 Hz tone becomes one A4; a two-tone sequence becomes two notes at the right pitches.
- Silence produces no notes; a confidence floor keeps noise from becoming notes.
- A pitch jump splits one note into two; a stable pitch across a breath does not.
- Tempo detection recovers a known tempo from evenly spaced onsets, and its output is clamped into a musical range.
- Quantisation goes through the existing service — asserted by the notes landing on grid positions it produces.
- An import always creates a **new** track and never modifies existing ones.
- `.mpa` takes the same path as `.mp3`.
- Export round-trip: render a one-note score, decode the result, and recover the pitch — the only test that proves export and import agree.
- Mute and solo are respected by export.
- **e2e** — import a short generated tone file and see notes appear; export a score and get a non-empty file of the right type.

## Out of scope

- **Polyphonic transcription** and instrument separation. Decided explicitly; revisit only with a pretrained model and eyes open about quality.
- **Microphone recording.** Files only.
- **Key detection** from audio. The score's key is used as-is.
- **Dynamics, articulation or timbre** from the recording — pitch and timing only. Velocity is a constant.
- **Streaming or very long files.** A whole file is decoded into memory; a multi-hour recording is not a use case here.
- **`.MOD`.** The next project.
