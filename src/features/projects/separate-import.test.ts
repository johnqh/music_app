/**
 * The separation import's sequence, with every piece replaced.
 *
 * None of the real pieces run in jsdom — no model, no codec, no server — so
 * what is testable is the order they are called in and what is done with what
 * they return. That is also where this can actually go wrong: sending the drums
 * through the pitched model, converting each stem at its own tempo, or writing
 * a track for a stem that was silent.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SeparationFailedError,
  separateAndTranscribe,
  type SeparateImportDeps,
} from '@/features/projects/separate-import';
import type { DecodedAudio, Separation } from '@sudobility/music_types';

const SR = 22050;

const audio = (seconds = 1): DecodedAudio => ({
  samples: new Float32Array(Math.round(seconds * SR)),
  sampleRate: SR,
});

/** A drum stem with hits on the beat, so `transcribeDrums` finds something real. */
function drumStem(beats = 8, beatSec = 0.5): DecodedAudio {
  const samples = new Float32Array(Math.round((beats + 1) * beatSec * SR));
  for (let b = 0; b < beats; b += 1) {
    const start = Math.round(b * beatSec * SR);
    const length = Math.round(0.15 * SR);
    for (let i = 0; i < length; i += 1) {
      const envelope = Math.exp((-5 * i) / length) * Math.min(1, i / 44);
      samples[start + i] += 0.9 * envelope * Math.sin((2 * Math.PI * 60 * i) / SR);
    }
  }
  return { samples, sampleRate: SR };
}

function makeDeps(overrides: Partial<SeparateImportDeps> = {}) {
  const ready: Separation = {
    id: 'sep-1',
    status: 'ready',
    stems: ['vocals', 'bass'],
    error: null,
    createdAt: '',
    finishedAt: null,
  };
  const deps: SeparateImportDeps = {
    encodeWav: vi.fn(() => new ArrayBuffer(8)),
    decode: vi.fn(async () => audio()),
    transcribe: vi.fn(async () => [
      { midi: 60, startSec: 0, durationSec: 0.5, amplitude: 0.8 },
      { midi: 62, startSec: 0.5, durationSec: 0.5, amplitude: 0.8 },
    ]),
    createSeparation: vi.fn(async () => ({ ...ready, status: 'running' as const, stems: [] })),
    getSeparation: vi.fn(async () => ready),
    fetchStem: vi.fn(async () => new ArrayBuffer(8)),
    sleep: async () => {},
    ...overrides,
  };
  return deps;
}

describe('separateAndTranscribe', () => {
  it('uploads the mix, waits for the stems, and hears each one', async () => {
    const deps = makeDeps();
    const result = await separateAndTranscribe(audio(), deps);

    expect(deps.encodeWav).toHaveBeenCalled();
    expect(deps.createSeparation).toHaveBeenCalled();
    expect(deps.fetchStem).toHaveBeenCalledTimes(2);
    expect(result.stems.map((s) => s.kind).sort()).toEqual(['bass', 'vocals']);
  });

  it('polls until the separation is ready rather than reading the first answer', async () => {
    const responses: Separation[] = [
      { id: 'sep-1', status: 'running', stems: [], error: null, createdAt: '', finishedAt: null },
      { id: 'sep-1', status: 'running', stems: [], error: null, createdAt: '', finishedAt: null },
      {
        id: 'sep-1',
        status: 'ready',
        stems: ['vocals'],
        error: null,
        createdAt: '',
        finishedAt: null,
      },
    ];
    const getSeparation = vi.fn(async () => responses.shift()!);
    const deps = makeDeps({ getSeparation });

    const result = await separateAndTranscribe(audio(), deps);
    expect(getSeparation).toHaveBeenCalledTimes(3);
    expect(result.stems.map((s) => s.kind)).toEqual(['vocals']);
  });

  it('never sends the drum stem through the pitched model', async () => {
    // Basic Pitch reports no drums at all; running the drum stem through it
    // would produce a track of whatever pitches a cymbal happens to excite.
    const ready: Separation = {
      id: 'sep-1',
      status: 'ready',
      stems: ['drums'],
      error: null,
      createdAt: '',
      finishedAt: null,
    };
    const transcribe = vi.fn(async () => []);
    const deps = makeDeps({
      getSeparation: vi.fn(async () => ready),
      decode: vi.fn(async () => drumStem()),
      transcribe,
    });

    const result = await separateAndTranscribe(audio(), deps);

    expect(transcribe).not.toHaveBeenCalled();
    expect(result.stems[0].kind).toBe('drums');
    expect(result.stems[0].notes.length).toBeGreaterThan(0);
  });

  it('gives every stem the same tempo, because they are one performance', async () => {
    const ready: Separation = {
      id: 'sep-1',
      status: 'ready',
      stems: ['vocals', 'bass'],
      error: null,
      createdAt: '',
      finishedAt: null,
    };
    // The bass plays at half the rate of the vocal. One tempo has to cover
    // both, and the notes have to land in proportion.
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce(
        Array.from({ length: 16 }, (_, i) => ({
          midi: 60,
          startSec: i * 0.5,
          durationSec: 0.25,
          amplitude: 1,
        })),
      )
      .mockResolvedValueOnce(
        Array.from({ length: 8 }, (_, i) => ({
          midi: 40,
          startSec: i * 1,
          durationSec: 0.5,
          amplitude: 1,
        })),
      );
    const deps = makeDeps({ getSeparation: vi.fn(async () => ready), transcribe });

    const result = await separateAndTranscribe(audio(), deps);

    const vocals = result.stems.find((s) => s.kind === 'vocals')!;
    const bass = result.stems.find((s) => s.kind === 'bass')!;
    // Same tempo means the bass's second note is twice as far in as the
    // vocal's second note — the ratio the recording had.
    expect(bass.notes[1].startTick).toBe(vocals.notes[2].startTick);
    expect(result.bpm).toBeGreaterThan(0);
  });

  it('drops a stem that came back silent instead of writing an empty track', async () => {
    const ready: Separation = {
      id: 'sep-1',
      status: 'ready',
      stems: ['vocals', 'guitar'],
      error: null,
      createdAt: '',
      finishedAt: null,
    };
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce([{ midi: 60, startSec: 0, durationSec: 0.5, amplitude: 1 }])
      .mockResolvedValueOnce([]);
    const deps = makeDeps({ getSeparation: vi.fn(async () => ready), transcribe });

    const result = await separateAndTranscribe(audio(), deps);
    expect(result.stems.map((s) => s.kind)).toEqual(['vocals']);
  });

  it('reports what it is doing, naming the stem it is on', async () => {
    const seen: string[] = [];
    const deps = makeDeps({ onProgress: (p) => seen.push(p.label) });
    await separateAndTranscribe(audio(), deps);

    expect(seen[0]).toMatch(/uploading/i);
    expect(seen.some((l) => /separating/i.test(l))).toBe(true);
    expect(seen.some((l) => /vocals/i.test(l))).toBe(true);
    expect(seen.some((l) => /bass/i.test(l))).toBe(true);
  });

  it('surfaces the server’s reason when separation fails', async () => {
    const failed: Separation = {
      id: 'sep-1',
      status: 'failed',
      stems: [],
      error: 'CUDA out of memory',
      createdAt: '',
      finishedAt: null,
    };
    const deps = makeDeps({ getSeparation: vi.fn(async () => failed) });

    await expect(separateAndTranscribe(audio(), deps)).rejects.toThrow('CUDA out of memory');
  });

  it('fails with a stated reason when the server gives none', async () => {
    const failed: Separation = {
      id: 'sep-1',
      status: 'failed',
      stems: [],
      error: null,
      createdAt: '',
      finishedAt: null,
    };
    const deps = makeDeps({ getSeparation: vi.fn(async () => failed) });

    await expect(separateAndTranscribe(audio(), deps)).rejects.toThrow(SeparationFailedError);
  });

  it('hears the stems one at a time, not all at once', async () => {
    // Each one runs the same model, and the model holds GPU memory while it
    // works; six concurrently is six times the memory for the same work.
    const ready: Separation = {
      id: 'sep-1',
      status: 'ready',
      stems: ['vocals', 'bass', 'piano'],
      error: null,
      createdAt: '',
      finishedAt: null,
    };
    let running = 0;
    let peak = 0;
    const transcribe = vi.fn(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return [{ midi: 60, startSec: 0, durationSec: 0.5, amplitude: 1 }];
    });
    const deps = makeDeps({ getSeparation: vi.fn(async () => ready), transcribe });

    await separateAndTranscribe(audio(), deps);
    expect(peak).toBe(1);
  });
});
