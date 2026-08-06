# Audio Import and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** export a score as `.wav` or `.mp3`, and turn a recording of a single melodic line back into notes.

**Architecture:** Decoding and encoding are platform-bound, so they become an `AudioCodec` interface in `music_types` implemented in `music_io`, beside `MidiCodec`. The analysis is **not** platform-bound — pitch tracking, segmentation and tempo detection are pure functions over a `Float32Array` in `music_lib`, testable with synthesised input and no browser.

**Tech Stack:** TypeScript (strict), Web Audio, Tone.js offline rendering, `lamejs`, Vitest, Playwright, Bun.

## Global Constraints

- **Monophonic only.** One line at a time. Chords and mixes are out of scope and the dialog says so.
- **Voice is not special.** A vocal file takes exactly the same path as a flute one; "voice-to-tone" is what the importer already is.
- **`.mpa` is `.mp3`.** Same MPEG decode path, no separate handling beyond the extension.
- **An import always creates a new track**, named after the file. Nothing existing is ever overwritten.
- **Tempo is detected from the audio**, and the detected value is shown in the dialog so it can be corrected before committing.
- **Quantisation reuses the existing quantiser.** Transcription emits raw ticks; the app runs `music_lib`'s quantize service over the resulting track. No second implementation of "put this on a grid".
- **Analysis lives in `music_lib`, codecs in `music_io`.** Nothing in `music_app` does signal processing.
- **Export renders through the same instruments playback uses**, and respects mute and solo.
- **Do not commit or push.** `scripts/push_all.sh` does that.
- Publish order: `music_types` → `music_io`/`music_lib` → `music_app`. Use `bun update`, not `bun add`, after publishing.

---

## File Structure

| File                                                     | Responsibility                                     |
| -------------------------------------------------------- | -------------------------------------------------- |
| `music_types/src/index.ts`                               | `AudioCodec`, `DecodedAudio`.                      |
| `music_io/src/shared/types.ts`                           | `audioCodec` on `MusicIo`.                         |
| `music_io/src/web/audio/`                                | **New.** Web decode/encode.                        |
| `music_io/src/contract/platform-contract.ts`             | Contract coverage for the new capability.          |
| `music_lib/src/domain/audio/pitch-track.ts`              | **New.** YIN pitch detection.                      |
| `music_lib/src/domain/audio/segment.ts`                  | **New.** Frames → notes; onsets → tempo.           |
| `music_lib/src/domain/audio/transcribe.ts`               | **New.** The pipeline, ending in tick-based notes. |
| `music_lib/src/services/export/audio-export.ts`          | **New.** Offline render to samples.                |
| `music_app/src/components/dialogs/AudioImportDialog.tsx` | **New.** Pick a file, confirm tempo.               |
| `music_app/src/components/layout/AppLayout.tsx`          | Import and export menu entries.                    |

---

### Task 1: The codec capability

**Files:**

- Modify: `~/projects/music_types/src/index.ts`
- Modify: `~/projects/music_io/src/shared/types.ts`, `src/web/index.ts`, `src/mocks/`
- Create: `~/projects/music_io/src/web/audio/web-audio-codec.ts`
- Modify: `~/projects/music_io/src/contract/platform-contract.ts`

**Interfaces:**

- Produces:

```ts
export type DecodedAudio = { samples: Float32Array; sampleRate: number };

/** Platform-bound audio decoding and encoding. Web uses Web Audio; RN will not. */
export interface AudioCodec {
  /** Decode .wav/.mp3/.mpa to **mono** PCM. Mixes channels down; analysis is monophonic anyway. */
  decode(bytes: ArrayBuffer): Promise<DecodedAudio>;
  encodeWav(audio: DecodedAudio): ArrayBuffer;
  encodeMp3(audio: DecodedAudio): ArrayBuffer;
}
```

- [x] **Step 1: Add the interface and wire it through**

In `music_types`, declare `DecodedAudio` and `AudioCodec` beside `MidiCodec`.
In `music_io/src/shared/types.ts`, add `audioCodec: AudioCodec` to `MusicIo` and
import the type. Both mocks and the web entry must supply one or the build
breaks — which is the point of the contract.

- [x] **Step 2: Write the failing contract test**

Add to `~/projects/music_io/src/contract/platform-contract.ts`, inside
`runPlatformContract`, so **every** platform must satisfy it:

```ts
it('exposes an audio codec', () => {
  expect(createIo().audioCodec).toBeDefined();
});

it('round-trips samples through WAV', () => {
  // The only test that proves encode and decode agree. A 440Hz tone in,
  // the same tone out — checked by zero-crossing count, not by bytes,
  // since a decoder may resample.
  const io = createIo();
  const sampleRate = 44100;
  const samples = new Float32Array(sampleRate);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  const wav = io.audioCodec.encodeWav({ samples, sampleRate });
  expect(wav.byteLength).toBeGreaterThan(samples.length * 2);
  // RIFF header, so the file is a real WAV and not a bare buffer.
  expect(new TextDecoder().decode(new Uint8Array(wav, 0, 4))).toBe('RIFF');
  expect(new TextDecoder().decode(new Uint8Array(wav, 8, 4))).toBe('WAVE');
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `cd ~/projects/music_io && bun run test contract`
Expected: FAIL — no `audioCodec` on either implementation.

- [x] **Step 4: Implement the web codec**

Create `~/projects/music_io/src/web/audio/web-audio-codec.ts`:

```ts
/**
 * Web audio decoding and encoding.
 *
 * Decoding leans on `AudioContext.decodeAudioData`, which already understands
 * wav and mp3 (and therefore .mpa, which is the same MPEG audio) — so nothing
 * has to bundle a decoder. Encoding mp3 does need one; wav is a header and the
 * samples.
 */
import type { AudioCodec, DecodedAudio } from '@sudobility/music_types';

/** Mixes to mono: the analysis is monophonic, and stereo would double the work for nothing. */
function toMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) out[i] += data[i] / channels;
  }
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

export function createWebAudioCodec(): AudioCodec {
  return {
    async decode(bytes: ArrayBuffer): Promise<DecodedAudio> {
      const ctx = new (window.AudioContext ?? window.webkitAudioContext)();
      try {
        const buffer = await ctx.decodeAudioData(bytes.slice(0));
        return { samples: toMono(buffer), sampleRate: buffer.sampleRate };
      } finally {
        void ctx.close();
      }
    },

    encodeWav({ samples, sampleRate }: DecodedAudio): ArrayBuffer {
      const bytes = samples.length * 2;
      const out = new ArrayBuffer(44 + bytes);
      const view = new DataView(out);
      writeAscii(view, 0, 'RIFF');
      view.setUint32(4, 36 + bytes, true);
      writeAscii(view, 8, 'WAVE');
      writeAscii(view, 12, 'fmt ');
      view.setUint32(16, 16, true); // PCM chunk size
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // mono
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true); // byte rate
      view.setUint16(32, 2, true); // block align
      view.setUint16(34, 16, true); // bits per sample
      writeAscii(view, 36, 'data');
      view.setUint32(40, bytes, true);
      for (let i = 0; i < samples.length; i += 1) {
        // Clamped before scaling: a sample slightly over 1.0 would wrap to a
        // loud click rather than clipping quietly.
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, clamped * 0x7fff, true);
      }
      return out;
    },

    encodeMp3({ samples, sampleRate }: DecodedAudio): ArrayBuffer {
      const encoder = new Mp3Encoder(1, sampleRate, 128);
      const pcm = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i += 1) {
        pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
      }
      const chunks: Uint8Array[] = [];
      const BLOCK = 1152; // one MPEG frame's worth
      for (let i = 0; i < pcm.length; i += BLOCK) {
        const encoded = encoder.encodeBuffer(pcm.subarray(i, i + BLOCK));
        if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
      }
      const tail = encoder.flush();
      if (tail.length > 0) chunks.push(new Uint8Array(tail));

      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
      }
      return out.buffer;
    },
  };
}
```

Add `lamejs` as a dependency of `music_io` and import `Mp3Encoder` from it.
Give the mock codec a real `encodeWav` (the header code above is
platform-free) and a `decode` that returns a synthesised tone, so the contract
test is meaningful on both.

- [x] **Step 5: Run the tests to verify they pass**

Run: `cd ~/projects/music_io && bun run verify`

---

### Task 2: Pitch tracking

**Files:**

- Create: `~/projects/music_lib/src/domain/audio/pitch-track.ts`
- Create: `~/projects/music_lib/src/domain/audio/pitch-track.test.ts`

**Interfaces:**

```ts
export type PitchFrame = { timeSec: number; hz: number; confidence: number };
export function trackPitch(samples: Float32Array, sampleRate: number): PitchFrame[];
```

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { trackPitch } from './pitch-track.js';

const SR = 44100;

/** `seconds` of a sine at `hz`. */
function tone(hz: number, seconds: number, sampleRate = SR): Float32Array {
  const out = new Float32Array(Math.floor(sampleRate * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

describe('trackPitch', () => {
  it('finds the fundamental of a pure tone', () => {
    // The whole feature rests on this being right, so it is asserted in Hz
    // rather than by anything downstream.
    const frames = trackPitch(tone(440, 0.5), SR).filter((f) => f.confidence > 0.8);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(Math.abs(frame.hz - 440)).toBeLessThan(5);
  });

  it('follows a change of pitch', () => {
    const a = tone(220, 0.4);
    const b = tone(330, 0.4);
    const both = new Float32Array(a.length + b.length);
    both.set(a, 0);
    both.set(b, a.length);

    const frames = trackPitch(both, SR).filter((f) => f.confidence > 0.8);
    expect(frames[0].hz).toBeCloseTo(220, -1);
    expect(frames[frames.length - 1].hz).toBeCloseTo(330, -1);
  });

  it('reports low confidence for silence', () => {
    // The floor that stops breath noise becoming a run of grace notes.
    const frames = trackPitch(new Float32Array(SR / 2), SR);
    expect(frames.every((f) => f.confidence < 0.5)).toBe(true);
  });

  it('reports low confidence for white noise', () => {
    const noise = new Float32Array(SR / 2);
    // Deterministic pseudo-noise: Math.random would make this test flaky.
    for (let i = 0; i < noise.length; i += 1)
      noise[i] = ((i * 1103515245 + 12345) % 2000) / 1000 - 1;
    const confident = trackPitch(noise, SR).filter((f) => f.confidence > 0.9);
    expect(confident.length).toBeLessThan(noise.length / 4410);
  });

  it('timestamps frames in seconds', () => {
    const frames = trackPitch(tone(440, 1), SR);
    expect(frames[0].timeSec).toBe(0);
    expect(frames[frames.length - 1].timeSec).toBeGreaterThan(0.8);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test pitch-track`

- [x] **Step 3: Implement YIN**

```ts
/**
 * Monophonic pitch detection (YIN).
 *
 * Pure over a sample buffer — no Web Audio, no DOM — so it is testable with a
 * synthesised tone and a known answer. Polyphonic material is out of scope by
 * construction: YIN reports one fundamental, and on a chord that is whichever
 * partial happens to dominate.
 */
export type PitchFrame = { timeSec: number; hz: number; confidence: number };

const FRAME = 2048;
const HOP = 512;
/** Roughly C2 to D6 — the range a voice or a single-line instrument occupies. */
const MIN_HZ = 65;
const MAX_HZ = 1200;
/** Below this the frame is treated as unvoiced by callers. */
const THRESHOLD = 0.15;

export function trackPitch(samples: Float32Array, sampleRate: number): PitchFrame[] {
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxTau = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(FRAME / 2));
  const frames: PitchFrame[] = [];

  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    const window = samples.subarray(start, start + FRAME);

    // 1. Difference function.
    const diff = new Float32Array(maxTau + 1);
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      let sum = 0;
      for (let i = 0; i + tau < FRAME; i += 1) {
        const d = window[i] - window[i + tau];
        sum += d * d;
      }
      diff[tau] = sum;
    }

    // 2. Cumulative mean normalised difference — what makes YIN robust to
    //    amplitude, and what turns "smallest difference" into a usable score.
    const norm = new Float32Array(maxTau + 1);
    norm[0] = 1;
    let running = 0;
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      running += diff[tau];
      norm[tau] = running === 0 ? 1 : (diff[tau] * (tau - minTau + 1)) / running;
    }

    // 3. First dip below the threshold, else the best available.
    let best = minTau;
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      if (norm[tau] < norm[best]) best = tau;
      if (norm[tau] < THRESHOLD) {
        // Walk to the local minimum rather than taking the first crossing.
        while (tau + 1 <= maxTau && norm[tau + 1] < norm[tau]) tau += 1;
        best = tau;
        break;
      }
    }

    // 4. Parabolic interpolation, so the estimate is not quantised to whole
    //    samples — the difference between 440Hz and 437Hz at this frame size.
    const prev = norm[best - 1] ?? norm[best];
    const next = norm[best + 1] ?? norm[best];
    const denominator = 2 * (2 * norm[best] - prev - next);
    const shift = denominator === 0 ? 0 : (next - prev) / denominator;

    frames.push({
      timeSec: start / sampleRate,
      hz: sampleRate / (best + shift),
      confidence: Math.max(0, Math.min(1, 1 - norm[best])),
    });
  }

  return frames;
}
```

- [x] **Step 4: Run the tests to verify they pass**

If the noise test is flaky at the chosen threshold, tighten `THRESHOLD` rather
than loosening the assertion — a detector that finds confident pitches in noise
is the failure this test exists to catch.

---

### Task 3: Notes and tempo

**Files:**

- Create: `~/projects/music_lib/src/domain/audio/segment.ts`, `segment.test.ts`

**Interfaces:**

```ts
export type DetectedNote = { startSec: number; endSec: number; midi: number };
export function segmentNotes(frames: readonly PitchFrame[]): DetectedNote[];
export function detectTempo(onsetsSec: readonly number[]): number;
```

- [x] **Step 1: Write the failing test**

```ts
const frame = (timeSec: number, hz: number, confidence = 0.95) => ({ timeSec, hz, confidence });
/** `count` frames at `hz` starting at `from`, one every 512/44100s. */
function run(from: number, hz: number, count: number, confidence = 0.95) {
  const step = 512 / 44100;
  return Array.from({ length: count }, (_, i) => frame(from + i * step, hz, confidence));
}

describe('segmentNotes', () => {
  it('turns a stable run of frames into one note', () => {
    const notes = segmentNotes(run(0, 440, 40));
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(69);
  });

  it('splits when the pitch changes', () => {
    const notes = segmentNotes([...run(0, 440, 30), ...run(0.35, 523.25, 30)]);
    expect(notes.map((n) => n.midi)).toEqual([69, 72]);
  });

  it('ignores frames below the confidence floor', () => {
    // Breath and room noise, which would otherwise become grace notes.
    expect(segmentNotes(run(0, 440, 40, 0.1))).toHaveLength(0);
  });

  it('ends a note at a gap of silence', () => {
    const notes = segmentNotes([
      ...run(0, 440, 30),
      ...run(0.35, 440, 30, 0.05),
      ...run(0.7, 440, 30),
    ]);
    expect(notes).toHaveLength(2);
  });

  it('discards a blip too short to be a note', () => {
    expect(segmentNotes(run(0, 440, 2))).toHaveLength(0);
  });
});

describe('detectTempo', () => {
  it('recovers a tempo from evenly spaced onsets', () => {
    // 120bpm quarter notes are 0.5s apart.
    const onsets = Array.from({ length: 9 }, (_, i) => i * 0.5);
    expect(detectTempo(onsets)).toBeCloseTo(120, 0);
  });

  it('folds an out-of-range result into a musical one', () => {
    // 0.15s apart is 400bpm; the musical reading is 200.
    const onsets = Array.from({ length: 9 }, (_, i) => i * 0.15);
    const bpm = detectTempo(onsets);
    expect(bpm).toBeGreaterThanOrEqual(50);
    expect(bpm).toBeLessThanOrEqual(200);
  });

  it('falls back to 120 when there is nothing to go on', () => {
    expect(detectTempo([])).toBe(120);
    expect(detectTempo([1])).toBe(120);
  });

  it('survives an uneven performance', () => {
    // Roughly 100bpm with human wobble; the answer should be near it, not wild.
    const onsets = [0, 0.61, 1.18, 1.82, 2.39, 3.02];
    const bpm = detectTempo(onsets);
    expect(bpm).toBeGreaterThan(80);
    expect(bpm).toBeLessThan(120);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

- [x] **Step 3: Implement segmentation and tempo**

```ts
/** Below this a frame is unvoiced: breath, room tone, the tail of a note. */
const MIN_CONFIDENCE = 0.6;
/** Shorter than this is a blip, not a note. */
const MIN_NOTE_SEC = 0.05;

const hzToMidi = (hz: number): number => Math.round(69 + 12 * Math.log2(hz / 440));

export function segmentNotes(frames: readonly PitchFrame[]): DetectedNote[] {
  const notes: DetectedNote[] = [];
  let current: { midi: number; startSec: number; endSec: number } | null = null;

  const flush = (): void => {
    if (current && current.endSec - current.startSec >= MIN_NOTE_SEC) notes.push({ ...current });
    current = null;
  };

  for (const f of frames) {
    if (f.confidence < MIN_CONFIDENCE || f.hz <= 0) {
      flush();
      continue;
    }
    const midi = hzToMidi(f.hz);
    if (!current || current.midi !== midi) {
      flush();
      current = { midi, startSec: f.timeSec, endSec: f.timeSec };
    } else {
      current.endSec = f.timeSec;
    }
  }
  flush();
  return notes;
}

const MIN_BPM = 50;
const MAX_BPM = 200;
const DEFAULT_BPM = 120;

/**
 * Tempo from the spacing between note onsets.
 *
 * The median inter-onset interval, folded into a musical range. Median rather
 * than mean because one long held note should not drag the estimate; folding
 * because a run of eighth notes is indistinguishable from quarters at half the
 * tempo, and the musical reading is the one in range.
 */
export function detectTempo(onsetsSec: readonly number[]): number {
  if (onsetsSec.length < 2) return DEFAULT_BPM;

  const gaps = [];
  for (let i = 1; i < onsetsSec.length; i += 1) {
    const gap = onsetsSec[i] - onsetsSec[i - 1];
    if (gap > 0.05) gaps.push(gap);
  }
  if (gaps.length === 0) return DEFAULT_BPM;

  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];

  let bpm = 60 / median;
  while (bpm > MAX_BPM) bpm /= 2;
  while (bpm < MIN_BPM) bpm *= 2;
  return Math.round(bpm);
}
```

- [x] **Step 4: Run the tests to verify they pass**

- [x] **Step 5: Verify the tests are not vacuous**

Drop the confidence check and confirm the floor test fails. Remove the folding
loop and confirm the range test fails. Check each edit actually landed before
trusting the result.

---

### Task 4: The pipeline

**Files:**

- Create: `~/projects/music_lib/src/domain/audio/transcribe.ts`, `transcribe.test.ts`
- Modify: `~/projects/music_lib/src/index.ts`

**Interfaces:**

```ts
export type TranscribedNote = { midi: number; startTick: number; durationTicks: number };
export type Transcription = { bpm: number; notes: TranscribedNote[] };
export function transcribe(audio: DecodedAudio, ppq: number): Transcription;
```

- [x] **Step 1: Write the failing test**

```ts
describe('transcribe', () => {
  it('turns a two-tone recording into two notes in ticks', () => {
    const audio = { samples: twoTones(440, 523.25, 0.5), sampleRate: 44100 };
    const { notes, bpm } = transcribe(audio, 480);
    expect(notes.map((n) => n.midi)).toEqual([69, 72]);
    expect(notes[0].startTick).toBe(0);
    expect(notes[1].startTick).toBeGreaterThan(0);
    expect(bpm).toBeGreaterThanOrEqual(50);
  });

  it('emits ticks against the detected tempo, not a fixed one', () => {
    // Same melody, played twice as fast: the tick positions should match,
    // because the tempo moved with it. This is what makes the detected tempo
    // load-bearing rather than decorative.
    const slow = transcribe({ samples: twoTones(440, 523.25, 0.6), sampleRate: 44100 }, 480);
    const fast = transcribe({ samples: twoTones(440, 523.25, 0.3), sampleRate: 44100 }, 480);
    expect(fast.bpm).toBeGreaterThan(slow.bpm);
  });

  it('produces nothing from silence', () => {
    expect(transcribe({ samples: new Float32Array(44100), sampleRate: 44100 }, 480).notes).toEqual(
      [],
    );
  });
});
```

with a `twoTones(a, b, secondsEach)` helper built the same way as
`pitch-track.test.ts`'s `tone`.

- [x] **Step 2: Run it to verify it fails**

- [x] **Step 3: Implement it**

```ts
/**
 * Recording → notes in ticks.
 *
 * Emits **unquantised** ticks against the detected tempo. Quantisation is the
 * caller's step, using the quantiser music_lib already has — this file
 * deliberately does not grow a second implementation of "put it on a grid".
 */
export function transcribe(audio: DecodedAudio, ppq: number): Transcription {
  const detected = segmentNotes(trackPitch(audio.samples, audio.sampleRate));
  const bpm = detectTempo(detected.map((n) => n.startSec));
  const ticksPerSecond = (bpm / 60) * ppq;

  return {
    bpm,
    notes: detected.map((note) => ({
      midi: note.midi,
      startTick: Math.round(note.startSec * ticksPerSecond),
      // At least one tick: a note rounding to zero length would vanish.
      durationTicks: Math.max(1, Math.round((note.endSec - note.startSec) * ticksPerSecond)),
    })),
  };
}
```

Export the whole `domain/audio` folder from `music_lib/src/index.ts`.

- [x] **Step 4: Run the tests to verify they pass**

---

### Task 5: Import dialog and export

**Files:**

- Create: `~/projects/music_app/src/components/dialogs/AudioImportDialog.tsx` and its test
- Modify: `~/projects/music_app/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe('AudioImportDialog', () => {
  it('says plainly that only one line at a time works', () => {
    // Better than letting somebody import a band recording and conclude the
    // feature is broken.
    render(<AudioImportDialog open onImport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/one melodic line/i)).toBeVisible();
  });

  it('shows the detected tempo once a file is analysed, and lets it be corrected', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(
      <AudioImportDialog
        open
        analysis={{ bpm: 118, notes: [] }}
        onImport={onImport}
        onClose={vi.fn()}
      />,
    );

    const tempo = screen.getByLabelText('Tempo');
    expect(tempo).toHaveValue(118);
    await user.clear(tempo);
    await user.type(tempo, '90');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith(90);
  });

  it('imports at the detected tempo when it is not touched', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(
      <AudioImportDialog
        open
        analysis={{ bpm: 118, notes: [] }}
        onImport={onImport}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith(118);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

- [ ] **Step 3: Build the dialog**

`AudioImportDialog` takes `{ open, analysis?, onFile, onImport, onClose }`: a
file input accepting `.wav,.mp3,.mpa`, the monophonic caveat as body text, and —
once `analysis` is present — a Tempo number field pre-filled with `analysis.bpm`
and an Import button reporting the field's value.

- [ ] **Step 4: Wire import and export into the menu**

Import: read the file, `getAppServices().io.audioCodec.decode(...)`,
`transcribe(...)`, show the dialog, and on confirm **add a new track** named
after the file and write the notes into it, then run `music_lib`'s existing
quantize service over that track.

Export: render offline through the playback engine to samples, then
`encodeWav`/`encodeMp3`, then `fileExporter.save(...)` — the same three-step
shape the MIDI and MusicXML exports already use.

- [ ] **Step 5: Run the tests**

---

### Task 6: End to end

- [ ] **Step 1: Write the e2e**

Generate a WAV of two tones **in the browser** (a few lines of `Float32Array`
plus the same header writer, or a fixture committed under `e2e/fixtures/`),
import it, and assert a new track appears with two notes. Then export the score
as WAV and assert the download is non-empty and starts with `RIFF`.

Wait for the import dialog to be **hidden** before touching the canvas — the
overlay intercepts clicks, which has cost two debugging rounds already.

- [ ] **Step 2: Run everything**

```bash
cd ~/projects/music_types && bun run verify
cd ~/projects/music_io && bun run verify
cd ~/projects/music_lib && bun run verify
cd ~/projects/music_app && bun run verify && bun run test:e2e
```

- [ ] **Step 3: Try it by hand**

Hum a simple melody into any recorder, save it as `.wav`, and import it. Check
by eye: the notes match what you hummed, the tempo is plausible, and a new
track appeared rather than your work being overwritten. Then export and listen
— it should sound exactly like pressing play.

---

## Self-Review

**Spec coverage.** wav/mp3/mpa decode and encode → Task 1. Monophonic pitch detection → Task 2. Segmentation with a confidence floor → Task 3. Tempo detected, shown, correctable → Tasks 3 and 5. Quantisation reusing the existing service → Task 5 Step 4 (transcription deliberately emits raw ticks). New track always → Task 5. Export through the same instruments, respecting mute/solo → Task 5. Analysis in `music_lib`, codecs in `music_io` → Tasks 1-4. Voice needing nothing extra → true by construction; no task adds a voice path. e2e → Task 6.

**Deliberate gaps, stated rather than hidden:**

- **`detectTempo` uses the median inter-onset interval, not autocorrelation of an onset envelope.** Much simpler, and adequate for a single line where every onset is a note. It will do poorly on a melody of very mixed note lengths — which is exactly why Task 5 shows the number and lets it be changed.
- **The tempo test "survives an uneven performance" asserts a range, not a value.** A tighter assertion would be pinning the current algorithm rather than the behaviour that matters.
- **YIN runs O(FRAME × maxTau) per hop** — a few hundred ms of CPU for a 30-second file, single-threaded. Fine for import; it would need a worker if it ever ran live, which is a reason microphone input was scoped out.
- **`encodeMp3` is untested beyond "produces bytes".** Verifying an mp3 decodes correctly needs a decoder in the test environment; the round-trip test covers WAV, which is the format the e2e uses.
- **Task 5 describes the dialog's structure rather than its JSX**, as the snapshot dialogs did. Behaviour is pinned by the tests in Step 1.

**Type consistency.** `DecodedAudio` and `AudioCodec` are defined in Task 1 and consumed in Tasks 4 and 5. `PitchFrame` is produced in Task 2 and consumed in Task 3. `DetectedNote` is produced in Task 3 and consumed in Task 4. `Transcription`/`TranscribedNote` are produced in Task 4 and consumed by the dialog's `analysis` prop in Task 5.

---

## Execution Notes (2026-08-05/06) — PARTIAL: Tasks 1-4 complete

**Complete: Tasks 1, 2, 3, 4** — the codec capability and the whole
signal-processing pipeline. `music_lib` 1063 tests, `music_io` 120,
`music_types` 66.

- `pitch-track.ts` — YIN with cumulative mean normalised difference and
  parabolic interpolation. Recovers 440Hz within 5Hz, follows a pitch change,
  and reports low confidence for silence and for noise. 5 tests.
- `segment.ts` — frames to notes with a confidence floor and a minimum
  duration; tempo from the median inter-onset interval, folded into 50-200bpm.
  9 tests.
- `transcribe.ts` — the pipeline, emitting **unquantised** ticks against the
  detected tempo. 3 tests, including the one that makes the detected tempo
  load-bearing: the same melody played twice as fast must yield a higher bpm.

Sabotage-verified, each edit confirmed to have landed first: removing the
confidence floor fails two tests; removing the tempo folding fails the range
test.

**A test fixture bug worth recording.** The "low confidence for noise" test
failed at first, and the detector was right. My "deterministic pseudo-noise",
`(i * 1103515245 + 12345) % 2000`, is _periodic_ over a couple of thousand
samples — a signal with a real pitch, which YIN duly found. Replaced with a
proper LCG (~2^31 period). The plan even said "tighten THRESHOLD rather than
loosening the assertion" if this test misbehaved; both would have been wrong,
because the fixture was the problem.

**One deviation.** `DecodedAudio` is declared structurally in `transcribe.ts`
rather than imported from `music_types`, so the analysis did not have to wait
on a publish cycle. The shapes are identical and mutually assignable; when Task
1 lands the `AudioCodec` capability, this becomes a plain import and the local
alias goes.

**Remaining: Task 1** (the `AudioCodec` capability across `music_types` and
`music_io`, plus the `lamejs` dependency), **Task 5** (import dialog, export
handlers) and **Task 6** (e2e). Task 1 is where the publish cycles are.

Not committed — `scripts/push_all.sh` owns commits.

### Task 1 (second pass)

`music_types` **0.10.0** adds `AudioCodec`/`DecodedAudio` under `src/platform/`,
where the sibling capability interfaces already live — not in `index.ts` as the
plan assumed.

`music_io` gains a **platform-free** `shared/audio/wav.ts` used by every
implementation, so there is one WAV header rather than three that can disagree:

- **web** — `decodeAudioData` for wav/mp3/mpa, `lamejs` for mp3 encoding.
- **mocks** — the real `encodeWav`, `decodeWav` for decoding, mp3 stubbed.
- **rn** — wav works; mp3 decode and encode **throw with a clear message**
  rather than returning silence that would look like a transcription bug.

**The compile-time contract did its job.** Adding `audioCodec` to `MusicIo`
broke the React Native entry, which I had forgotten — exactly what the plan
predicted would happen and why the capability is a required field rather than
an optional one.

**One test relocated, deliberately.** The plan put a WAV round-trip in the
platform contract. It cannot live there: web's `decode` is
`AudioContext.decodeAudioData`, which does not exist under vitest, so the
contract can only assert the _shape_ of what `encodeWav` writes. The round-trip
moved to `shared/audio/wav.test.ts` — the code both implementations genuinely
share, where it tests something real instead of a mock agreeing with itself.
Sabotage-verified: removing the sample clamp fails the clipping test.

`lamejs` has no type declarations, so `src/types/lamejs.d.ts` declares exactly
the three members used — narrow on purpose, so anything else we start calling
surfaces as a type error rather than becoming `any`.

### Task 5 (partial) and what it uncovered

`AudioImportDialog` is built and tested (6 tests): the monophonic caveat stated
up front, Import disabled until a file is analysed, the detected tempo shown
and correctable, and the chosen file reported. `music_app` 578 tests green.

**The wiring is not done, and the plan was wrong about why it would be easy.**
Task 5 Step 4 says "add a new track named after the file" and "render offline
through the playback engine" as though both were one-liners. Neither exists:

1. **There is no add-track-with-notes command.** Writing a transcription into a
   new track needs either a new domain command or a loop of `addNoteCommand`
   against a track created first — and the latter is many undo steps for one
   import, the same mistake the drag-to-move work had to avoid.
2. **There is no offline render.** Export needs Tone.js `OfflineContext` driven
   through the existing playback engine, which is a real piece of work in
   `music_lib`/`music_io`, not a call site in `AppLayout`.

I wrote handlers assuming both, and the typechecker rejected them for calling
functions that do not exist. Reverted rather than left half-wired; the dialog
stands on its own and is fully tested.

### The first missing piece, built

`addTranscribedTrackCommand` in `music_lib` (6 tests, 1069 total green): adds a
**new** track with the score's own measure grid and writes the transcription
into it in **one undoable step** — hundreds of imported notes must not cost
hundreds of undo presses, which a loop of `addNoteCommand` would.

**A sabotage caught dead code in my own implementation.** I had written an
explicit "drop notes past the end of the track" guard, with a comment
explaining why. Removing it broke nothing: `insertNoteIntoTrack` already
ignores a note that falls in no measure, so the guard never ran. The
_behaviour_ was real and tested; my line was not the thing providing it.
Deleted, and the remaining measure lookup now says plainly that it exists for
the key signature. Re-verified by making out-of-range notes clamp to tick 0
instead, which does fail the test.

That is the second time this session a passing test turned out not to be
testing the code it appeared to. Sabotage-checking every new test is what
caught both.

### Import wired end to end

`music_lib` **1.6.0** published; `music_app` now has **Import → Audio…**:
decode via `io.audioCodec`, `transcribe`, show what was heard, and on confirm
`addTranscribedTrackCommand` writes a new track in one undoable step.
578 tests green.

The one piece of arithmetic in the wiring is pinned by its own tests: the
transcription is emitted against the **detected** tempo, so correcting the
tempo has to rescale the ticks. Getting that backwards is silent — the notes
still appear, just in the wrong bars — so "halve the tempo, halve the ticks"
and "never round a note away to nothing" are asserted directly.

**Import is complete. Export is not**, and the reason is unchanged: it needs an
offline render (Tone.js `OfflineContext` driven through the existing playback
engine), which belongs in `music_lib`/`music_io` and is a real piece of work
rather than a call site. Everything else for export already exists —
`encodeWav`/`encodeMp3` are implemented and tested, and `fileExporter` is the
same path MIDI and MusicXML already use.

### Export, half built

The offline render splits cleanly in two, and the split is the useful part:

- **`renderEvents(score)` in `music_lib`** — score in, timed events out, with
  a duration that includes a release tail. Everything _musical_ about an export
  lives here: which tracks sound (mute and solo, solo winning), when each note
  starts in seconds via `TempoMap`, and velocity normalised to 0..1 for the
  synth voices. 8 tests; 1077 total green. Sabotage-verified — ignoring solo
  fails two tests, dropping the tail fails two more.
- **The Tone.js binding in `music_io`** — still to write. `Tone.Offline` over
  `createInstrument(program, isPercussion)` and `triggerAttackRelease`, which
  is a thin loop over the events above.

Putting the boundary here means the part with musical rules is testable in node
and the part that needs an audio context is nearly trivial. The alternative —
a single `renderScore()` in `music_io` — would have put mute/solo and tempo
arithmetic somewhere no test can reach without a browser.

### The Tone binding, and a test that could not exist

`renderOffline(events, durationSec)` is written and exported from
`music_io/web`: one `Tone.Offline` render, instruments shared per GM program,
using the _same_ `createInstrument` playback uses so an export sounds like what
you heard rather than merely similar. `music_io` 120 tests still green.

**I tried to unit test it and deleted the test.** `Tone.Offline` needs a native
`OfflineAudioContext`, which vitest does not provide —
`Missing the native OfflineAudioContext constructor`. A test there could only
have asserted a mock agreeing with itself, and a permanently-skipped test reads
as coverage while providing none. The file now says where verification actually
lives: the e2e round trip — export a one-note score, decode the WAV, recover
the pitch.

This was flagged before writing it, not discovered afterwards; it is the one
part of the audio work that no node test can reach.

### Export wired — Task 5 complete

**Export → Audio (WAV)… / Audio (MP3)…** now render the score offline and save
it. `music_app` 581 tests green.

**Rendering became a capability rather than a bare import.** `renderOffline`
was exported as a plain function from `music_io/web`, and using it that way
from `music_app` would have broken this repo's own rule — platform services
come from `getAppServices().io`, never a direct import. So `AudioRenderer`
joined `music_types` (0.11.0) and `audioRenderer` joined `MusicIo` (music_io
0.6.0), with web supplying the real one and mocks/RN rejecting with a clear
message. One more publish cycle, and the architecture holds.

The chain reads as it should: `renderEvents(score)` decides what sounds,
`audioRenderer.render` schedules it through the same instruments as playback,
`encodeWav`/`encodeMp3` turn it into bytes, `fileExporter` saves it.

### Task 6: e2e written, failing on a real bug

`e2e/audio.spec.ts` builds a two-tone WAV in Node, imports it, and exports the
score back out. It **fails**, and the evidence points at the app rather than
the test.

The file input accepts the file — `setInputFiles` on `getByLabel('Audio file')`
succeeds, so the dialog was open at that moment. Four seconds later the page
shows the plain editor with **no dialog at all**, and no console error or page
throw. So the dialog is being dismissed by choosing a file, before the
transcription can come back.

The likely cause, untested: `@sudobility/components`' `Dialog` defaults
`closeOnOutsideClick` to true, and the file-chooser interaction reads as an
outside click. If so it is a genuine UX bug — picking a file must not close the
dialog you picked it in — and the fix is `closeOnOutsideClick={false}` on
`AudioImportDialog`, not a change to the test.

Worth confirming by hand before changing anything: open Import → Audio…, choose
a file, and watch whether the dialog survives. The e2e is left in place and
failing, because it is catching something real.
