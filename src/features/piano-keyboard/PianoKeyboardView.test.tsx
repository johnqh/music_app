import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  const actual = await vi.importActual<typeof import('@sudobility/music_lib')>(
    '@sudobility/music_lib',
  );
  return {
    ...actual,
    // Replaced wholesale, not spread: the real export is a lazy Proxy that
    // builds a Tone graph on first property access, which jsdom has no audio
    // for and which would demand an initialized platform.
    playbackController: { noteOn: vi.fn(), noteOff: vi.fn(), seek: vi.fn() },
  };
});
import type { Score } from '@sudobility/music_types';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { PianoKeyboardView } from '@/features/piano-keyboard/PianoKeyboardView';
import { LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';

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

/** Puts the store in the one state where keys light: actually playing. */
function play(store: EditorStoreApi, ids: string[]): void {
  act(() => {
    store.getState().setPlaybackState('playing');
    store.getState().setActiveNoteIds(ids);
  });
}

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

    it('follows an instrument change on the same track', () => {
      const store = makeStore();
      const { container } = render(<PianoKeyboardView store={store} />);

      setProgram(store, 58); // Tuba — low
      const low = [...container.querySelectorAll('[data-testid^="piano-key-"]')].map((el) =>
        Number(el.getAttribute('data-testid')!.replace('piano-key-', '')),
      );

      setProgram(store, 72); // Piccolo — high
      const high = [...container.querySelectorAll('[data-testid^="piano-key-"]')].map((el) =>
        Number(el.getAttribute('data-testid')!.replace('piano-key-', '')),
      );

      expect(Math.min(...high)).toBeGreaterThan(Math.max(...low));
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

    play(store, [note.id]);

    expect(key(container, pitchToMidi(note.pitch)).dataset.playing).toBe('true');
  });

  it('marks a lit key pressed, so state is not carried by color alone', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);
    const note = allNotes(store.getState().score!)[0];

    play(store, [note.id]);

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

    play(store, [other.id]);

    expect(key(container, pitchToMidi(other.pitch)).dataset.playing).toBe('false');
  });

  it('goes dark on pause even while notes are still reported as sounding', () => {
    // The Tone engine clears active notes on stop() but NOT on pause(), so
    // without the playbackState gate a paused chord would stay lit forever.
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);
    const note = allNotes(store.getState().score!)[0];
    play(store, [note.id]);
    expect(key(container, pitchToMidi(note.pitch)).dataset.playing).toBe('true');

    act(() => store.getState().setPlaybackState('paused'));

    expect(key(container, pitchToMidi(note.pitch)).dataset.playing).toBe('false');
  });

  it('shows nothing when stopped', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);
    const note = allNotes(store.getState().score!)[0];
    play(store, [note.id]);

    act(() => store.getState().setPlaybackState('stopped'));

    expect(container.querySelectorAll('[data-playing="true"]')).toHaveLength(0);
  });

  it('names the active track and follows it when it changes', () => {
    const store = makeStore(twoTrackScore());
    const score = store.getState().score!;
    const { container } = render(<PianoKeyboardView store={store} />);
    expect(container.textContent).toContain(score.tracks[0].name);

    act(() => store.getState().setActiveTrack(score.tracks[1].id));

    expect(container.textContent).toContain(score.tracks[1].name);
  });

  it('renders only the header when collapsed, so the expand control survives', () => {
    const { container, getByLabelText } = render(
      <PianoKeyboardView store={makeStore()} collapsed />,
    );
    expect(container.querySelectorAll('[data-testid^="piano-key-"]')).toHaveLength(0);
    expect(getByLabelText('Expand piano keyboard')).toBeInTheDocument();
  });

  it('uses the shared playing color, so notation and keyboard agree', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);
    const note = allNotes(store.getState().score!)[0];
    play(store, [note.id]);

    // Same role the notation colors a sounding note with.
    expect(LIGHT_RENDER_THEME.notePlaying).toBe('#1565c0');
    expect(key(container, pitchToMidi(note.pitch)).style.backgroundColor).toBe('rgb(21, 101, 192)');
  });
});

describe('header names the active instrument', () => {
  it('shows the active track instrument, not the literal "Piano"', () => {
    const store = makeStore(twoTrackScore());
    const score = store.getState().score!;
    act(() => {
      store
        .getState()
        .dispatchCommand(
          changeTrackPropsCommand(score.tracks[1].id, {
            midiProgram: 56,
            instrumentName: 'Trumpet',
          }),
        );
      store.getState().setActiveTrack(score.tracks[1].id);
    });

    const { container } = render(<PianoKeyboardView store={store} />);

    expect(container.textContent).toContain('Trumpet');
  });

  it('follows the active track', () => {
    const store = makeStore(twoTrackScore());
    const score = store.getState().score!;
    act(() => {
      store
        .getState()
        .dispatchCommand(
          changeTrackPropsCommand(score.tracks[0].id, {
            midiProgram: 40,
            instrumentName: 'Violin',
          }),
        );
      store
        .getState()
        .dispatchCommand(
          changeTrackPropsCommand(score.tracks[1].id, {
            midiProgram: 56,
            instrumentName: 'Trumpet',
          }),
        );
      store.getState().setActiveTrack(score.tracks[0].id);
    });
    const { container } = render(<PianoKeyboardView store={store} />);
    expect(container.textContent).toContain('Violin');

    act(() => store.getState().setActiveTrack(score.tracks[1].id));

    expect(container.textContent).toContain('Trumpet');
    expect(container.textContent).not.toContain('Violin');
  });

  it('falls back to "Keyboard" with no score', () => {
    const store = createAppStore({ context: testStoreContext() });
    const { container } = render(<PianoKeyboardView store={store} />);
    expect(container.textContent).toContain('Keyboard');
  });
});

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
    expect(vi.mocked(playbackController.noteOn)).toHaveBeenCalledWith(60, expect.any(Number));
    expect(vi.mocked(playbackController.noteOff)).toHaveBeenCalledWith(60);
  });

  it('writes a shorter note for a shorter tap', () => {
    const store = makeStore();
    const { container } = render(<PianoKeyboardView store={store} />);

    tap(container, 60, 500);
    const quarter = allNotes(store.getState().score!).find((n) => n.startTick === 0)!;
    const long = quarter.durationTicks;

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

    expect(vi.mocked(playbackController.seek)).toHaveBeenCalledWith(
      store.getState().score!.ppq, // one quarter past the start
    );
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
