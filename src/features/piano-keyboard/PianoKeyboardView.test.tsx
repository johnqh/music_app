import { commandLabel } from '@/features/score-editor/command-labels';
import {
  getMusicPosition,
  getMusicPositionSource,
  resetMusicPosition,
} from '@sudobility/music_types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import { getAppServices } from '@/config/initialize';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createAppStore,
  pitchToMidi,
  testStoreContext,
  twinkleScore,
  twoTrackScore,
} from '@sudobility/music_lib';
import { allNotes, changeTrackPropsCommand, playbackController } from '@sudobility/music_lib';

// The keyboard auditions through the controller; the real one would build a
// Tone graph, which jsdom has no audio for.
vi.mock('@sudobility/music_lib', async () => {
  const actual =
    await vi.importActual<typeof import('@sudobility/music_lib')>('@sudobility/music_lib');
  return {
    ...actual,
    // Replaced wholesale, not spread: the real export is a lazy Proxy that
    // builds a Tone graph on first property access, which jsdom has no audio
    // for and which would demand an initialized platform.
    // A real bus, because the keyboard subscribes to it for its key lighting;
    // the rest is replaced so nothing builds an audio graph in jsdom.
    playbackController: {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      seek: vi.fn(),
      bus: new actual.PlaybackBus(),
    },
  };
});
import type { Score, SoundingNote } from '@sudobility/music_types';
import type { EditorStoreApi } from '@sudobility/music_lib';
import { addNoteCommand, createEmptyScore } from '@sudobility/music_lib';
import { PianoKeyboardView } from '@/features/piano-keyboard/PianoKeyboardView';
import { LIGHT_RENDER_THEME } from '@sudobility/music_drawing';

function makeStore(score: Score = twinkleScore()): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(score);
  return store;
}

function key(container: HTMLElement, midi: number): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="piano-key-${midi}"]`);
  if (!el) throw new Error(`no key rendered for midi ${midi}`);
  return el;
}

/**
 * Puts the store in the one state where keys light: actually playing.
 *
 * Sounding notes arrive resolved now, so the fixture states the track and pitch
 * rather than an id the component would have to look up.
 */
function asSounding(note: {
  id: string;
  trackId: string;
  pitch: Parameters<typeof pitchToMidi>[0];
}): SoundingNote {
  return { noteId: note.id, trackId: note.trackId, midi: pitchToMidi(note.pitch) };
}

function play(store: EditorStoreApi, notes: SoundingNote[]): void {
  act(() => {
    store.getState().setPlaybackState('playing');
    playbackController.bus.publishSounding(notes);
  });
}

// The keyboard resolves live MIDI input from the composition root, so the
// harness has to be installed -- it also registers the mock platform.
beforeEach(() => {
  installTestAppServices();
});

afterEach(() => {
  resetTestAppServices();
});

describe('PianoKeyboardView', () => {
  it('renders all 88 keys for a piano track', () => {
    const { container } = render(<PianoKeyboardView store={makeStore()} />);
    expect(container.querySelectorAll('[data-testid^="piano-key-"]')).toHaveLength(88);
  });

  describe('range follows the active track', () => {
    /** Sets the active track's instrument, as the track editor would. */
    function setProgram(store: EditorStoreApi, midiProgram: number): void {
      const score = store.getState().score!;
      act(() => {
        store.getState().setScore({
          ...score,
          tracks: score.tracks.map((track, i) => (i === 0 ? { ...track, midiProgram } : track)),
        });
      });
    }

    it('narrows to the instrument, so keys that cannot sound are not offered', () => {
      // A piccolo on an 88-key keyboard says nothing about what will sound.
      const store = makeStore();
      const { container } = render(<PianoKeyboardView store={store} />);
      expect(container.querySelectorAll('[data-testid^="piano-key-"]')).toHaveLength(88);

      setProgram(store, 72); // Piccolo

      const keys = container.querySelectorAll('[data-testid^="piano-key-"]');
      expect(keys.length).toBeLessThan(88);
      expect(keys.length).toBeGreaterThan(0);
    });

    /*
      An import can hold notes the instrument cannot play — an imported
      sub-octave bass layer reaches E0 on a bass whose lowest string is E1. The
      keyboard widens to show them, but those keys are pale and inert: a person
      can import such a note, not play one in.
    */
    it('shows imported notes below the compass on pale keys that do not play', () => {
      const score = twinkleScore();
      const track = score.tracks[0]!;
      const [first] = allNotes(score);
      const lowBass: Score = {
        ...score,
        tracks: [
          {
            ...track,
            midiProgram: 37, // Slap Bass 2: E1 (28) upward
            clef: 'bass',
            measures: track.measures.map((measure) => ({
              ...measure,
              voices: measure.voices.map((voice) => ({
                ...voice,
                events: voice.events.map((event) =>
                  event.id === first!.id
                    ? { ...event, pitch: { step: 'E', octave: 0, accidental: 0 } }
                    : event,
                ),
              })),
            })),
          },
        ],
      } as Score;
      const store = makeStore(lowBass);
      const { container } = render(<PianoKeyboardView store={store} />);

      const e0 = key(container, 16);
      expect(e0.getAttribute('aria-disabled')).toBe('true');
      expect(e0.style.backgroundColor).not.toBe(key(container, 40).style.backgroundColor);
      expect(key(container, 40).getAttribute('aria-disabled')).toBeNull();

      vi.mocked(playbackController.noteOn).mockClear();
      const before = store.getState().score;
      fireEvent.pointerDown(e0, { pointerId: 1 });
      fireEvent.pointerUp(e0, { pointerId: 1 });
      expect(vi.mocked(playbackController.noteOn)).not.toHaveBeenCalled();
      expect(store.getState().score).toBe(before);
    });

    it('follows an instrument change on the same track', () => {
      const store = makeStore();
      const { container } = render(<PianoKeyboardView store={store} />);

      // The PLAYABLE keys: the keyboard also shows the track's own notes,
      // greyed and inert where the instrument cannot reach them.
      const playable = () =>
        [...container.querySelectorAll('[data-testid^="piano-key-"]:not([aria-disabled])')].map(
          (el) => Number(el.getAttribute('data-testid')!.replace('piano-key-', '')),
        );
      setProgram(store, 58); // Tuba — low
      const low = playable();

      setProgram(store, 72); // Piccolo — high
      const high = playable();

      expect(Math.min(...high)).toBeGreaterThan(Math.max(...low));
    });

    /*
      The keys keep their SOUNDING midi numbers and only the lettering moves.
      On a B-flat trumpet read in written pitch the two differ by a tone, and
      the mismatch was silent: the key said C4, pressing it stored a sounding
      C4 — correctly — and the staff drew the D4 the player reads.
    */
    it('letters the keys in written pitch when the staff is', () => {
      const store = makeStore();
      const { container } = render(<PianoKeyboardView store={store} />);
      setProgram(store, 56); // Trumpet in B flat: written a tone above sounding

      const nameOf = (midi: number) =>
        container.querySelector(`[data-testid="piano-key-${midi}"]`)?.getAttribute('aria-label');

      // Concert pitch: the key is what it sounds.
      expect(nameOf(60)).toBe('C4');

      act(() => {
        store.getState().setPitchDisplay('written');
      });

      // Written: the same key, the same sounding note, lettered as the player
      // reads it — press it and a C4 appears on the staff.
      expect(nameOf(58)).toBe('C4');
      expect(nameOf(60)).toBe('D4');
    });

    it("leaves a piano's lettering alone in either mode", () => {
      const store = makeStore();
      const { container } = render(<PianoKeyboardView store={store} />);
      setProgram(store, 0);

      act(() => {
        store.getState().setPitchDisplay('written');
      });

      expect(
        container.querySelector('[data-testid="piano-key-60"]')?.getAttribute('aria-label'),
      ).toBe('C4');
    });

    it('begins and ends on a white key, which a black one cannot do', () => {
      // A black key at either end has no white neighbour to hang off.
      const store = makeStore();
      const { container } = render(<PianoKeyboardView store={store} />);
      setProgram(store, 65); // Alto Sax — its raw range starts on a black key

      const midis = [...container.querySelectorAll('[data-testid^="piano-key-"]')].map((el) =>
        Number(el.getAttribute('data-testid')!.replace('piano-key-', '')),
      );
      const black = [1, 3, 6, 8, 10];
      expect(black).not.toContain(Math.min(...midis) % 12);
      expect(black).not.toContain(Math.max(...midis) % 12);
    });
  });

  describe('a percussion track', () => {
    /** Turns the active track into a drum track carrying `program` as its kit. */
    function makeDrumStore(program = 0): EditorStoreApi {
      const store = makeStore();
      const trackId = store.getState().score!.tracks[0].id;
      act(() => {
        store
          .getState()
          .dispatchCommand(
            changeTrackPropsCommand(
              trackId,
              { clef: 'percussion' },
              commandLabel('changeTrackProps'),
            ),
          );
        store
          .getState()
          .dispatchCommand(
            changeTrackPropsCommand(
              trackId,
              { midiProgram: program },
              commandLabel('changeTrackProps'),
            ),
          );
        store.getState().setActiveTrack(trackId);
      });
      return store;
    }

    it('spans the drums, not the melodic instrument at that address', () => {
      // Reading a kit address as an instrument showed a piano's compass for a
      // kit: keys that could not sound a drum, and drums that could sound
      // (35-81) hanging off the end.
      const { container } = render(<PianoKeyboardView store={makeDrumStore()} />);

      const midis = [...container.querySelectorAll('[data-testid^="piano-key-"]')].map((el) =>
        Number(el.getAttribute('data-testid')!.replace('piano-key-', '')),
      );
      expect(Math.min(...midis)).toBe(35);
      expect(Math.max(...midis)).toBe(81);
    });

    it('names each key for the drum it strikes', () => {
      const { container } = render(<PianoKeyboardView store={makeDrumStore()} />);

      expect(key(container, 38)).toHaveAttribute('aria-label', 'Acoustic Snare');
      // A black key, and the most-played piece of the kit.
      expect(key(container, 42)).toHaveAttribute('aria-label', 'Closed Hi-Hat');
      expect(screen.getByText('Snare')).toBeInTheDocument();
      expect(screen.getByText('Cl HH')).toBeInTheDocument();
      // No pitch names anywhere: on a drum staff "C4" names nothing.
      expect(screen.queryByText('C4')).not.toBeInTheDocument();
    });
  });

  it('labels C and F, the landmarks of the black-key groups', () => {
    // With both labelled no white key is more than two steps from a reference;
    // labelling all seven per octave is legible only while the keys are wide.
    render(<PianoKeyboardView store={makeStore()} />);
    expect(screen.getByText('C4')).toBeInTheDocument();
    expect(screen.getByText('F4')).toBeInTheDocument();
    expect(screen.queryByText('D4')).not.toBeInTheDocument();
  });

  it('renders unlit with no score', () => {
    const store = createAppStore({ context: testStoreContext() });
    const { container } = render(<PianoKeyboardView store={store} />);
    const lit = container.querySelectorAll('[data-playing="true"]');
    expect(lit).toHaveLength(0);
  });

  it('lights the key of a sounding note on the active track', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);
    const note = allNotes(store.getState().score!)[0];

    play(store, [asSounding(note)]);

    expect(key(container, pitchToMidi(note.pitch)).dataset.playing).toBe('true');
  });

  it('marks a lit key pressed, so state is not carried by color alone', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);
    const note = allNotes(store.getState().score!)[0];

    play(store, [asSounding(note)]);

    const el = key(container, pitchToMidi(note.pitch));
    expect(el.style.transform).toContain('translateY');
    expect(el.style.boxShadow).toContain('inset');
    expect(el.style.backgroundColor).toBe('rgb(21, 101, 192)'); // theme.notePlaying
  });

  it('leaves keys unlit for notes sounding on another track', () => {
    const store = makeStore(twoTrackScore());
    const score = store.getState().score!;
    act(() => store.getState().setActiveTrack(score.tracks[0].id));
    const { container } = render(<PianoKeyboardView store={store} />);
    const other = allNotes(score).find((n) => n.trackId === score.tracks[1].id)!;

    play(store, [asSounding(other)]);

    expect(key(container, pitchToMidi(other.pitch)).dataset.playing).toBe('false');
  });

  it('goes dark on pause even while notes are still reported as sounding', () => {
    // The Tone engine clears active notes on stop() but NOT on pause(), so
    // without the playbackState gate a paused chord would stay lit forever.
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);
    const note = allNotes(store.getState().score!)[0];
    play(store, [asSounding(note)]);
    expect(key(container, pitchToMidi(note.pitch)).dataset.playing).toBe('true');

    act(() => store.getState().setPlaybackState('paused'));

    expect(key(container, pitchToMidi(note.pitch)).dataset.playing).toBe('false');
  });

  it('shows nothing when stopped', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);
    const note = allNotes(store.getState().score!)[0];
    play(store, [asSounding(note)]);

    act(() => store.getState().setPlaybackState('stopped'));

    expect(container.querySelectorAll('[data-playing="true"]')).toHaveLength(0);
  });

  it('draws nothing at all when collapsed', () => {
    /*
      It used to keep a header row so the expand control survived. The control
      is the transport bar's now, so there is nothing down here that has to
      stay on screen to remain reachable — and a row holding one button was the
      whole reason that header existed.
    */
    const { container } = render(<PianoKeyboardView store={makeStore()} collapsed />);
    expect(container.querySelectorAll('[data-testid^="piano-key-"]')).toHaveLength(0);
    expect(container.textContent).toBe('');
  });

  it('uses the shared playing color, so notation and keyboard agree', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);
    const note = allNotes(store.getState().score!)[0];
    play(store, [asSounding(note)]);

    // Same role the notation colors a sounding note with.
    expect(LIGHT_RENDER_THEME.notePlaying).toBe('#1565c0');
    expect(key(container, pitchToMidi(note.pitch)).style.backgroundColor).toBe('rgb(21, 101, 192)');
  });
});

/*
  The header that named the active instrument is gone with the rest of the
  keyboard's own bar — a whole row for one button, holding a label the canvas
  gutter already paints beside every system. `trackInstrumentLabel`'s rules,
  including the drum-kit address it exists for (program 40 is Brush as a kit and
  Violin as an instrument), are tested where they live, in music_types'
  `track-instrument.test.ts`.
*/

describe('playing the keyboard writes notes', () => {
  /** Presses a key, holds it for `heldMs` of mocked time, releases. */
  function tap(container: HTMLElement, midi: number, heldMs: number): void {
    let now = 1_000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    fireEvent.pointerDown(key(container, midi), { pointerId: 1 });
    now += heldMs;
    fireEvent.pointerUp(key(container, midi), { pointerId: 1 });
    clock.mockRestore();
  }

  it('sounds the key and writes a note of the length it was held', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);

    tap(container, 60, 500); // a quarter at 120bpm

    // Not a count delta: twinkleScore already opens with a quarter at tick 0,
    // and reflowVoice replaces on overlap rather than adding beside it.
    const written = allNotes(store.getState().score!).find((n) => n.startTick === 0)!;
    expect(written.durationTicks).toBe(store.getState().score!.ppq);
    expect(store.getState().canUndo).toBe(true);
    // The third argument is the active track's percussion flag, so a drum track
    // auditions on the kit rather than a pitched voice.
    expect(vi.mocked(playbackController.noteOn)).toHaveBeenCalledWith(
      60,
      expect.any(Number),
      false,
    );
    expect(vi.mocked(playbackController.noteOff)).toHaveBeenCalledWith(60);
  });

  it('writes a shorter note for a shorter tap', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);

    tap(container, 60, 500);
    const quarter = allNotes(store.getState().score!).find((n) => n.startTick === 0)!;
    const long = quarter.durationTicks;

    // A second, independent scenario — and the caret is a shared position now,
    // so it has to be put back or the second tap writes a bar later than the
    // first and this compares two different places in the score.
    resetMusicPosition();
    const store2 = makeStore();
    const { container: c2 } = render(<PianoKeyboardView store={store2} />);
    tap(c2, 60, 125); // a sixteenth
    const short = allNotes(store2.getState().score!).find((n) => n.startTick === 0)!.durationTicks;

    expect(short).toBeLessThan(long);
  });

  it('advances the caret, so a run of taps lays out a melody', () => {
    // Without this every tap would overwrite the same position.
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);

    tap(container, 60, 500);

    // One quarter past the start.
    expect(getMusicPosition().reportedTick).toBe(store.getState().score!.ppq);
  });

  it('draws a held key pressed, like a sounding one', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);

    fireEvent.pointerDown(key(container, 60), { pointerId: 1 });
    expect(key(container, 60)).toHaveAttribute('data-playing', 'true');

    fireEvent.pointerUp(key(container, 60), { pointerId: 1 });
    expect(key(container, 60)).toHaveAttribute('data-playing', 'false');
  });

  it('releases a key the pointer leaves, so the note cannot sustain forever', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);

    fireEvent.pointerDown(key(container, 60), { pointerId: 1 });
    fireEvent.pointerCancel(key(container, 60), { pointerId: 1 });

    expect(key(container, 60)).toHaveAttribute('data-playing', 'false');
    expect(vi.mocked(playbackController.noteOff)).toHaveBeenCalledWith(60);
  });
});

describe('playing several keys at once writes a chord', () => {
  /**
   * Presses every key in `midis`, holds them together for `heldMs`, then
   * releases them in order — i.e. plays a chord rather than a run of notes.
   */
  function playChord(container: HTMLElement, midis: number[], heldMs: number): void {
    let now = 1_000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    midis.forEach((midi, i) => {
      now += i === 0 ? 0 : 5; // real fingers never land on the same millisecond
      fireEvent.pointerDown(key(container, midi), { pointerId: midi });
    });
    now += heldMs;
    midis.forEach((midi) => {
      now += 5; // nor do they lift together
      fireEvent.pointerUp(key(container, midi), { pointerId: midi });
    });
    clock.mockRestore();
  }

  function emptyPianoStore(): EditorStoreApi {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(createEmptyScore({ title: 'Chord', measures: 2 }));
    return store;
  }

  it('writes one chord at one tick, not an arpeggio', () => {
    const store = emptyPianoStore();
    const { container } = render(<PianoKeyboardView store={store} />);

    playChord(container, [60, 64, 67], 500);

    const notes = allNotes(store.getState().score!);
    expect(notes).toHaveLength(3);
    // The point of the whole grouping: every note shares the start tick.
    expect(new Set(notes.map((n) => n.startTick))).toEqual(new Set([0]));
  });

  it('gives every note of the chord the same duration', () => {
    // Measuring each key separately is what made this dangerous: same-start
    // notes whose durations differ delete each other instead of stacking.
    const store = emptyPianoStore();
    const { container } = render(<PianoKeyboardView store={store} />);

    playChord(container, [60, 64, 67], 500);

    const notes = allNotes(store.getState().score!);
    expect(new Set(notes.map((n) => n.durationTicks)).size).toBe(1);
  });

  it('still writes a run of separate taps as a melody', () => {
    // Asserted on the notes themselves now. This used to count caret advances
    // instead, because seeking was mocked here and every note landed on tick 0
    // regardless — the caret is the shared position now, so it really moves and
    // the notes really spread out.
    const store = emptyPianoStore();
    const { container } = render(<PianoKeyboardView store={store} />);

    let now = 1_000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    for (const midi of [60, 62, 64]) {
      fireEvent.pointerDown(key(container, midi), { pointerId: midi });
      now += 500;
      fireEvent.pointerUp(key(container, midi), { pointerId: midi });
      now += 50; // released before the next is pressed — not a chord
    }
    clock.mockRestore();

    const ticks = allNotes(store.getState().score!).map((n) => n.startTick);
    expect(new Set(ticks).size).toBe(3);
  });

  it('advances the caret once for a chord, however many keys were held', () => {
    const store = emptyPianoStore();
    const { container } = render(<PianoKeyboardView store={store} />);
    playChord(container, [60, 64, 67], 500);

    // One position for the whole chord: three notes on one tick, and the caret
    // one note-length past it rather than three.
    const notes = allNotes(store.getState().score!);
    expect(notes).toHaveLength(3);
    expect(new Set(notes.map((n) => n.startTick)).size).toBe(1);
    expect(getMusicPosition().reportedTick).toBe(notes[0].durationTicks);
  });

  it('refuses the chord on a monophonic instrument and writes nothing', () => {
    const store = emptyPianoStore();
    const score = store.getState().score!;
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((t) => ({ ...t, midiProgram: 56, instrumentName: 'Trumpet' })),
    });
    const { container } = render(<PianoKeyboardView store={store} />);

    playChord(container, [60, 64, 67], 500);

    expect(allNotes(store.getState().score!)).toHaveLength(0);
    expect(store.getState().toasts.some((t) => /one note at a time/.test(t.message))).toBe(true);
  });
});

describe('the keyboard edits a selected chord', () => {
  function storeWithChord(): { store: EditorStoreApi; ids: string[] } {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(createEmptyScore({ title: 'Sel', measures: 2 }));
    const track = store.getState().score!.tracks[0];
    for (const step of ['C', 'E', 'G']) {
      store.getState().dispatchCommand(
        addNoteCommand(
          {
            trackId: track.id,
            measureId: track.measures[0].id,
            voiceIndex: 0,
            pitch: { step, accidental: 0, octave: 4 } as never,
            startTick: 0,
            durationTicks: store.getState().score!.ppq,
          },
          commandLabel('addNote'),
        ),
      );
    }
    const ids = allNotes(store.getState().score!)
      .filter((n) => n.startTick === 0)
      .map((n) => n.id);
    store.getState().setSelection({ eventIds: ids, measureIds: [], trackIds: [] });
    return { store, ids };
  }

  it('lights the selected pitches', () => {
    const { store } = storeWithChord();
    const { container } = render(<PianoKeyboardView store={store} />);
    expect(key(container, 60)).toHaveAttribute('data-selected', 'true'); // C4
    expect(key(container, 64)).toHaveAttribute('data-selected', 'true'); // E4
    expect(key(container, 62)).toHaveAttribute('data-selected', 'false'); // D4
  });

  it('removes a note when its lit key is pressed', () => {
    const { store } = storeWithChord();
    const { container } = render(<PianoKeyboardView store={store} />);

    fireEvent.pointerDown(key(container, 64), { pointerId: 1 });
    fireEvent.pointerUp(key(container, 64), { pointerId: 1 });

    expect(
      allNotes(store.getState().score!)
        .map((n) => n.pitch.step)
        .sort(),
    ).toEqual(['C', 'G']);
  });

  it('adds a note when an unlit key is pressed', () => {
    const { store } = storeWithChord();
    const { container } = render(<PianoKeyboardView store={store} />);

    fireEvent.pointerDown(key(container, 62), { pointerId: 1 }); // D4
    fireEvent.pointerUp(key(container, 62), { pointerId: 1 });

    const atZero = allNotes(store.getState().score!).filter((n) => n.startTick === 0);
    expect(atZero.map((n) => n.pitch.step).sort()).toEqual(['C', 'D', 'E', 'G']);
  });

  it('does not advance the caret while editing a selection', () => {
    // The two jobs must not both happen: that would edit the chord AND move on.
    const { store } = storeWithChord();
    const { container } = render(<PianoKeyboardView store={store} />);
    const seek = vi.mocked(playbackController.seek);
    seek.mockClear();

    fireEvent.pointerDown(key(container, 62), { pointerId: 1 });
    fireEvent.pointerUp(key(container, 62), { pointerId: 1 });

    // Seeks to the chord's own tick, never past it.
    for (const call of seek.mock.calls) expect(call[0]).toBe(0);
  });

  it('stays in entry mode when the selection spans several ticks', () => {
    const { store } = storeWithChord();
    const track = store.getState().score!.tracks[0];
    const ppq = store.getState().score!.ppq;
    store.getState().dispatchCommand(
      addNoteCommand(
        {
          trackId: track.id,
          measureId: track.measures[0].id,
          voiceIndex: 0,
          pitch: { step: 'A', accidental: 0, octave: 4 } as never,
          startTick: ppq,
          durationTicks: ppq,
        },
        commandLabel('addNote'),
      ),
    );
    const all = allNotes(store.getState().score!).map((n) => n.id);
    store.getState().setSelection({ eventIds: all, measureIds: [], trackIds: [] });

    const { container } = render(<PianoKeyboardView store={store} />);
    resetMusicPosition();

    fireEvent.pointerDown(key(container, 62), { pointerId: 1 });
    fireEvent.pointerUp(key(container, 62), { pointerId: 1 });

    // Entry mode advances the caret past what it wrote; edit mode never does.
    expect(getMusicPosition().reportedTick).toBeGreaterThan(0);
  });
});

describe('PianoKeyboardView: MIDI keyboard input', () => {
  /** Installs a fake MIDI port and hands back its event emitter. */
  function withMidi(): { emit: (event: unknown) => void } {
    const ctx = testStoreContext();
    installTestAppServices(ctx);
    const io = getAppServices().io as unknown as { midiInput: Record<string, unknown> };
    let handler: ((event: unknown) => void) | null = null;
    io.midiInput = {
      isSupported: () => true,
      listDevices: async () => [{ id: 'p1', name: 'Fake' }],
      subscribe: (h: (event: unknown) => void) => {
        handler = h;
        return () => {
          handler = null;
        };
      },
    };
    return { emit: (event) => handler?.(event) };
  }

  it('writes a note when a hardware key is played', async () => {
    // Routed through the same handlers as the on-screen keys, so the held
    // time becomes the duration and the caret advances — one set of rules.
    const midi = withMidi();
    const store = makeStore();
    act(() => getMusicPositionSource().moveTo(0));
    render(<PianoKeyboardView store={store} />);

    // The pitch at the caret, not the note count: the editor's default edit
    // mode is `replace`, so writing over an occupied position swaps the note
    // rather than adding one.
    const pitchAtCaret = () => {
      const note = allNotes(store.getState().score!).find((n) => n.startTick === 0);
      return note ? pitchToMidi(note.pitch) : null;
    };
    expect(pitchAtCaret()).not.toBe(62);

    act(() => midi.emit({ type: 'on', note: 62, velocity: 90 }));
    await new Promise((r) => setTimeout(r, 120));
    act(() => midi.emit({ type: 'off', note: 62 }));

    await waitFor(() => {
      expect(pitchAtCaret()).toBe(62);
    });
  });

  it('sounds the note while it is held', () => {
    const midi = withMidi();
    const store = makeStore();
    render(<PianoKeyboardView store={store} />);

    act(() => midi.emit({ type: 'on', note: 60, velocity: 80 }));

    expect(vi.mocked(playbackController.noteOn)).toHaveBeenCalled();
  });

  it('subscribes to nothing on a platform without MIDI', () => {
    // The default fake reports unsupported; rendering must not throw, and no
    // device picker should ever be offered.
    const store = makeStore();
    expect(() => render(<PianoKeyboardView store={store} />)).not.toThrow();
  });
});
