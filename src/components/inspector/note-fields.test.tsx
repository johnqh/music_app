/**
 * The note's position, typed as a bar and a beat.
 *
 * What is pinned is the half a reader sees: a typed position that moves the
 * note is committed as one tick, and one that does not — blank, no such bar, a
 * move the store refused — puts both fields back to where the note is, rather
 * than leaving text on screen the score does not hold. A refusal also has to be
 * *said*, or it is indistinguishable from a typo being snapped back.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createEmptyScore } from '@sudobility/music_types';
import { createAppStore, testStoreContext } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@sudobility/music_lib';
import { BarBeatField } from '@/components/inspector/note-fields';

const score = createEmptyScore({ title: 'Test', measures: 4 });

const makeStore = (): EditorStoreApi => createAppStore({ context: testStoreContext() });

describe('BarBeatField', () => {
  it('commits a typed beat as a tick', async () => {
    const onCommit = vi.fn(() => true);
    render(<BarBeatField store={makeStore()} score={score} tick={0} onCommit={onCommit} />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Beat'));
    await user.type(screen.getByLabelText('Beat'), '3');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith(2 * score.ppq);
  });

  it('puts a position that names no bar back to where the note is', async () => {
    const onCommit = vi.fn(() => true);
    render(<BarBeatField store={makeStore()} score={score} tick={0} onCommit={onCommit} />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Bar'));
    await user.type(screen.getByLabelText('Bar'), '999');
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Bar')).toHaveValue('1');
  });

  it('puts a cleared field back rather than leaving it blank', async () => {
    const onCommit = vi.fn(() => true);
    render(<BarBeatField store={makeStore()} score={score} tick={0} onCommit={onCommit} />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Beat'));
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Beat')).toHaveValue('1');
  });

  it('shows where the note is again when the move is refused', async () => {
    // A move the store declines leaves the tick where it was, so nothing
    // re-renders the fields with a new position; they have to reset themselves.
    render(<BarBeatField store={makeStore()} score={score} tick={0} onCommit={() => false} />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Bar'));
    await user.type(screen.getByLabelText('Bar'), '2');
    await user.tab();

    expect(screen.getByLabelText('Bar')).toHaveValue('1');
  });

  it('says so when the move is refused, rather than silently snapping back', async () => {
    // The refusal reaches the same toast queue every other editing refusal
    // does — an out-of-range pitch, an instrument too narrow for a part.
    const store = makeStore();
    render(<BarBeatField store={store} score={score} tick={0} onCommit={() => false} />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Bar'));
    await user.type(screen.getByLabelText('Bar'), '2');
    await user.tab();

    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].severity).toBe('warning');
    // Words, not the key: a toast reading `inspector.moveRefused` is what a
    // key missing from the locale looks like, and nothing else would fail.
    expect(store.getState().toasts[0].message).not.toContain('inspector.');
  });

  it('says nothing when the move landed, or when there was nothing to commit', async () => {
    const store = makeStore();
    render(<BarBeatField store={store} score={score} tick={0} onCommit={() => true} />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Bar'));
    await user.type(screen.getByLabelText('Bar'), '2');
    await user.tab();
    await user.clear(screen.getByLabelText('Beat'));
    await user.tab();

    expect(store.getState().toasts).toEqual([]);
  });
});
