import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  allNotes,
  createAppStore,
  setLyricCommand,
  testStoreContext,
  twinkleScore,
} from '@sudobility/music_lib';
import type { NoteEvent } from '@sudobility/music_types';
import { LyricEntryBar } from '@/features/score-editor/LyricEntryBar';
import { syllabicFor } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@sudobility/music_lib';

function makeStore(): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twinkleScore());
  return store as unknown as EditorStoreApi;
}

function notesOf(store: EditorStoreApi): NoteEvent[] {
  return allNotes(store.getState().score!).sort((a, b) => a.startTick - b.startTick);
}

function lyricsOf(store: EditorStoreApi): Array<string | undefined> {
  return notesOf(store).map((n) => n.lyric?.text);
}

describe('syllabicFor', () => {
  it('derives the join from the hyphens either side', () => {
    // The writer hyphenates as they type; they should not also have to say
    // "this is the middle of a word".
    expect(syllabicFor(false, false)).toBe('single');
    expect(syllabicFor(false, true)).toBe('begin');
    expect(syllabicFor(true, true)).toBe('middle');
    expect(syllabicFor(true, false)).toBe('end');
  });
});

describe('LyricEntryBar', () => {
  it('writes a word and moves to the next note on space', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    render(
      <LyricEntryBar store={store} notes={notesOf(store)} startIndex={0} onClose={() => {}} />,
    );

    await user.keyboard('twinkle ');

    expect(lyricsOf(store)[0]).toBe('twinkle');
    expect(screen.getByText(/Note 2 of/)).toBeInTheDocument();
  });

  it('hyphenates a syllable within a word, which is what draws the hyphen', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    render(
      <LyricEntryBar store={store} notes={notesOf(store)} startIndex={0} onClose={() => {}} />,
    );

    await user.keyboard('beau-ti-ful ');

    const notes = notesOf(store);
    expect(notes[0].lyric).toEqual({ text: 'beau', syllabic: 'begin' });
    expect(notes[1].lyric).toEqual({ text: 'ti', syllabic: 'middle' });
    expect(notes[2].lyric).toEqual({ text: 'ful', syllabic: 'end' });
  });

  it('types a whole line in order', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    render(
      <LyricEntryBar store={store} notes={notesOf(store)} startIndex={0} onClose={() => {}} />,
    );

    await user.keyboard('twin-kle twin-kle little ');

    expect(lyricsOf(store).slice(0, 5)).toEqual(['twin', 'kle', 'twin', 'kle', 'little']);
  });

  it('steps back over a typo instead of restarting the line', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    render(
      <LyricEntryBar store={store} notes={notesOf(store)} startIndex={0} onClose={() => {}} />,
    );

    await user.keyboard('one two ');
    await user.keyboard('{Shift>} {/Shift}');

    expect(screen.getByText(/Note 2 of/)).toBeInTheDocument();
    // The syllable already there is shown, rather than a blank field.
    expect(screen.getByLabelText('Syllable')).toHaveValue('two');
  });

  it('finishes on Enter, keeping what was typed', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    let closed = false;
    render(
      <LyricEntryBar
        store={store}
        notes={notesOf(store)}
        startIndex={0}
        onClose={() => {
          closed = true;
        }}
      />,
    );

    await user.keyboard('end{Enter}');

    expect(closed).toBe(true);
    expect(lyricsOf(store)[0]).toBe('end');
  });

  it('starts wherever entry began, not always at the first note', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    render(
      <LyricEntryBar store={store} notes={notesOf(store)} startIndex={4} onClose={() => {}} />,
    );

    await user.keyboard('here ');

    expect(lyricsOf(store)[4]).toBe('here');
    expect(lyricsOf(store)[0]).toBeUndefined();
  });

  it('clears a syllable when the field is emptied', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    const notes = notesOf(store);
    act(() => {
      // A word already there, to be removed.
      store.getState().dispatchCommand(setLyricCommand(notes[0].id, { text: 'gone' }, 'Lyric'));
    });
    render(
      <LyricEntryBar store={store} notes={notesOf(store)} startIndex={0} onClose={() => {}} />,
    );

    await user.clear(screen.getByLabelText('Syllable'));
    await user.keyboard('{Enter}');

    expect(lyricsOf(store)[0]).toBeUndefined();
  });
});
