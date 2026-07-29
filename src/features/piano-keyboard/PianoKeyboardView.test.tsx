import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  allNotes,
  createAppStore,
  pitchToMidi,
  testStoreContext,
  twinkleScore,
  twoTrackScore,
} from '@sudobility/music_lib';
import { changeTrackPropsCommand } from '@sudobility/music_lib';
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
  it('renders all 88 keys', () => {
    const { container } = render(<PianoKeyboardView store={makeStore()} />);
    expect(container.querySelectorAll('[data-testid^="piano-key-"]')).toHaveLength(88);
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
