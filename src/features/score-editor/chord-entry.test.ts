import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMusicPosition, resetMusicPosition } from '@sudobility/music_types';

vi.mock('@sudobility/music_lib', async () => {
  const actual =
    await vi.importActual<typeof import('@sudobility/music_lib')>('@sudobility/music_lib');
  return {
    ...actual,
    // Replaced wholesale, not spread: the real export is a lazy Proxy bound to
    // the global app store, and these tests drive an isolated one.
    playbackController: {
      bus: new actual.PlaybackBus(),
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      seek: vi.fn(),
    },
  };
});

import {
  createAppStore,
  testStoreContext,
  createEmptyScore,
  allNotes,
} from '@sudobility/music_lib';
import type { Pitch } from '@sudobility/music_types';
import { insertChordAtCaret } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@sudobility/music_lib';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';

const pitch = (step: string, octave = 4): Pitch =>
  ({ step, accidental: 0, octave }) as unknown as Pitch;

const TRIAD = [pitch('C'), pitch('E'), pitch('G')];

/** An empty two-measure score whose single track uses `midiProgram`. */
function makeStore(midiProgram = 0): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  const score = createEmptyScore({ title: 'Chord', measures: 2 });
  store.getState().setScore({
    ...score,
    tracks: score.tracks.map((t) => ({ ...t, midiProgram })),
  });
  store.getState().setActiveTrack(store.getState().score!.tracks[0].id);
  return store;
}

/** Notes starting at `tick` on the active track — `allNotes` spans every track. */
const notesAt = (store: EditorStoreApi, tick: number) => {
  const trackId = store.getState().score!.tracks[0].id;
  return allNotes(store.getState().score!).filter(
    (n) => n.startTick === tick && n.trackId === trackId,
  );
};

describe('insertChordAtCaret', () => {
  // Advancing the caret goes through playbackController, which resolves its
  // engine from the platform registry.
  beforeEach(() => installTestAppServices());
  afterEach(() => resetTestAppServices());

  it('writes every pitch at one tick with one duration', () => {
    const store = makeStore(0); // Acoustic Grand Piano
    expect(insertChordAtCaret(store, TRIAD)).toBe(true);

    const written = notesAt(store, 0);
    expect(written).toHaveLength(3);
    // One shared duration is what makes it a chord rather than a collision:
    // same-start notes with differing durations delete each other.
    expect(new Set(written.map((n) => n.durationTicks)).size).toBe(1);
    expect(written.map((n) => n.pitch.step).sort()).toEqual(['C', 'E', 'G']);
  });

  it('refuses a chord on a monophonic instrument, and writes nothing', () => {
    const store = makeStore(56); // Trumpet
    expect(insertChordAtCaret(store, TRIAD)).toBe(false);
    expect(notesAt(store, 0)).toHaveLength(0);
    expect(store.getState().toasts.some((t) => /one note at a time/.test(t.message))).toBe(true);
  });

  it('still allows a single note on a monophonic instrument', () => {
    const store = makeStore(56);
    expect(insertChordAtCaret(store, [pitch('C')])).toBe(true);
    expect(notesAt(store, 0)).toHaveLength(1);
  });

  it('allows a double stop on a violin but refuses a triad', () => {
    const violin = makeStore(40);
    expect(insertChordAtCaret(violin, [pitch('C'), pitch('E')])).toBe(true);
    expect(notesAt(violin, 0)).toHaveLength(2);

    const other = makeStore(40);
    expect(insertChordAtCaret(other, TRIAD)).toBe(false);
    expect(notesAt(other, 0)).toHaveLength(0);
  });

  it('counts notes already at the tick, so a second pass cannot exceed the limit', () => {
    // Two separate double stops would otherwise put four notes under one bow.
    // Stack, because that is the mode that keeps what is already there —
    // replace removes it, so there is nothing left to count.
    const store = makeStore(40);
    store.getState().setEditMode('stack');
    expect(insertChordAtCaret(store, [pitch('C'), pitch('E')])).toBe(true);
    expect(insertChordAtCaret(store, [pitch('G'), pitch('B')])).toBe(false);
    expect(notesAt(store, 0)).toHaveLength(2);
  });

  it('advances the caret once for the whole chord, not once per note', () => {
    const store = makeStore(0);
    store.getState().setSnapGrid('quarter');
    resetMusicPosition();

    insertChordAtCaret(store, TRIAD, { advanceCaret: true });

    // Past one note's worth — three notes sharing a span move the caret as far
    // as one note does, not three times as far.
    expect(getMusicPosition().reportedTick).toBe(store.getState().score!.ppq);
  });

  it('does not move the caret when the chord was refused', () => {
    const store = makeStore(56); // Trumpet
    resetMusicPosition();
    insertChordAtCaret(store, TRIAD, { advanceCaret: true });
    expect(getMusicPosition().reportedTick).toBe(0);
  });

  it('is a no-op for an empty pitch list', () => {
    const store = makeStore(0);
    expect(insertChordAtCaret(store, [])).toBe(false);
    expect(notesAt(store, 0)).toHaveLength(0);
  });

  describe('edit modes', () => {
    /** Writes a C quarter at tick 0 so there is something to displace. */
    function withExistingNote(store: EditorStoreApi): void {
      store.getState().setSnapGrid('quarter');
      insertChordAtCaret(store, [pitch('C')]);
    }

    it('replace mode overwrites what was there', () => {
      const store = makeStore(0);
      store.getState().setEditMode('replace');
      withExistingNote(store);

      insertChordAtCaret(store, [pitch('E')]);

      expect(notesAt(store, 0).map((n) => n.pitch.step)).toEqual(['E']);
    });

    it('stack mode joins what was there', () => {
      const store = makeStore(0);
      store.getState().setEditMode('stack');
      withExistingNote(store);

      insertChordAtCaret(store, [pitch('E')]);

      expect(
        notesAt(store, 0)
          .map((n) => n.pitch.step)
          .sort(),
      ).toEqual(['C', 'E']);
    });

    it('insert mode pushes what was there later', () => {
      const store = makeStore(0);
      store.getState().setEditMode('insert');
      withExistingNote(store);

      insertChordAtCaret(store, [pitch('E')]);

      const ppq = store.getState().score!.ppq;
      expect(notesAt(store, 0).map((n) => n.pitch.step)).toEqual(['E']);
      expect(notesAt(store, ppq).map((n) => n.pitch.step)).toEqual(['C']);
    });

    it('a chord in insert mode opens one gap, not one per note', () => {
      const store = makeStore(0);
      store.getState().setEditMode('insert');
      withExistingNote(store);

      insertChordAtCaret(store, [pitch('E'), pitch('G')]);

      const ppq = store.getState().score!.ppq;
      // The displaced C moved by one note's worth, not two.
      expect(notesAt(store, ppq).map((n) => n.pitch.step)).toEqual(['C']);
    });

    it('stack on an instrument that cannot play a chord writes as replace', () => {
      // The stored choice is stack, but a trumpet cannot stack, so the write
      // uses the effective mode: the new note replaces the old one rather than
      // being refused for a chord nobody asked for. Replace does not count the
      // notes it removes.
      const store = makeStore(56); // Trumpet
      store.getState().setEditMode('stack');
      withExistingNote(store);

      expect(insertChordAtCaret(store, [pitch('E')])).toBe(true);
      expect(notesAt(store, 0).map((n) => n.pitch.step)).toEqual(['E']);
      expect(store.getState().editMode).toBe('stack');
    });
  });
});

describe('voices', () => {
  const voicesAt = (store: EditorStoreApi, tick: number) => {
    const track = store.getState().score!.tracks[0];
    const measure = track.measures.find(
      (m) => tick >= m.startTick && tick < m.startTick + m.durationTicks,
    )!;
    return measure.voices;
  };

  it('writes into the active voice, creating it on demand', () => {
    const store = makeStore(0);
    store.getState().setActiveVoice(1);

    insertChordAtCaret(store, [pitch('C')]);

    const voices = voicesAt(store, 0);
    expect(voices.length).toBeGreaterThanOrEqual(2);
    expect(voices[1].events.some((e) => 'pitch' in e)).toBe(true);
  });

  it('keeps the two voices independent', () => {
    // The whole point: a second line on the same stave, not a chord in the
    // first one. Writing into voice 2 must not disturb voice 1.
    const store = makeStore(0);
    store.getState().setActiveVoice(0);
    insertChordAtCaret(store, [pitch('C')]);
    const voiceOneBefore = voicesAt(store, 0)[0].events.filter((e) => 'pitch' in e).length;

    store.getState().setActiveVoice(1);
    insertChordAtCaret(store, [pitch('G', 3)]);

    const voices = voicesAt(store, 0);
    expect(voices[0].events.filter((e) => 'pitch' in e).length).toBe(voiceOneBefore);
    expect(voices[1].events.filter((e) => 'pitch' in e).length).toBe(1);
  });

  it('replace mode only clears the voice being written to', () => {
    // Clearing the span across every voice would delete the other line, which
    // is the opposite of what a second voice is for.
    const store = makeStore(0);
    store.getState().setEditMode('replace');
    store.getState().setActiveVoice(0);
    insertChordAtCaret(store, [pitch('C')]);

    store.getState().setActiveVoice(1);
    insertChordAtCaret(store, [pitch('G', 3)]);

    const voices = voicesAt(store, 0);
    expect(voices[0].events.some((e) => 'pitch' in e)).toBe(true);
    expect(voices[1].events.some((e) => 'pitch' in e)).toBe(true);
  });
});
