/**
 * The score's context menu — where cut, copy, paste, clear and delete live now.
 *
 * Two things here are the whole reason the menu exists rather than four toolbar
 * buttons. It **names its subject**, because Delete means three different edits
 * depending on whether a track, a span of bars or a run of notes is selected and
 * a button on a bar cannot say which. And it offers **Clear beside Delete**,
 * which the toolbar never did because the action did not exist: a cleared bar
 * keeps its number and its markings, a deleted one takes the rest of the score
 * up with it.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScoreContextMenu } from '@/features/score-editor/ScoreContextMenu';
import { scoreContextMenuModel } from '@/app-library';
import type { ClipboardData } from '@/app-library';
import type { ScoreSelection } from '@sudobility/music_types';

/*
  The rules — which entries are live, what the header says — are
  music_editing's `scoreContextMenuModel`, tested there. These render the
  model, so what is pinned here is that the menu draws what it is handed.
*/
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const noteSelection = (n: number): ScoreSelection => ({
  eventIds: ids('n', n),
  measureIds: [],
  trackIds: [],
});
const selections: Record<string, (n: number) => ScoreSelection> = {
  track: () => ({ eventIds: [], measureIds: [], trackIds: ['t0'] }),
  measures: (n) => ({ eventIds: [], measureIds: ids('m', n), trackIds: [] }),
  notes: noteSelection,
};
const NOTES_CLIPBOARD: ClipboardData = { kind: 'notes', events: [], anchorTick: 0 };

function open(
  input: {
    selection?: ScoreSelection;
    clipboard?: ClipboardData | null;
    playing?: boolean;
  } = {},
) {
  const onAction = vi.fn();
  const onClose = vi.fn();
  render(
    <ScoreContextMenu
      x={10}
      y={10}
      model={scoreContextMenuModel({
        selection: input.selection ?? noteSelection(1),
        clipboard: input.clipboard ?? null,
        playing: input.playing ?? false,
      })}
      onAction={onAction}
      onClose={onClose}
    />,
  );
  return { onAction, onClose };
}

const item = (name: string) => screen.getByRole('menuitem', { name });

describe('the subject header', () => {
  it.each<[string, number, string]>([
    ['track', 1, 'Track'],
    ['measures', 1, 'Bar'],
    ['measures', 4, 'Bars'],
    ['notes', 1, 'Note'],
    ['notes', 3, 'Notes'],
  ])('names %s (%i) as "%s"', (kind, count, label) => {
    open({ selection: selections[kind](count) });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('says nothing when nothing is selected', () => {
    // A header with no subject would be a label for an empty statement.
    open({ selection: noteSelection(0) });
    expect(screen.queryByText('Track')).not.toBeInTheDocument();
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });
});

describe('the entries', () => {
  it('offers Clear and Delete as separate choices', () => {
    // They are different edits, not two names for one — which is why this is
    // two entries rather than one entry and a question.
    open();
    expect(item('Clear')).toBeEnabled();
    expect(item('Delete selection')).toBeEnabled();
  });

  it('reports which one was chosen', async () => {
    const { onAction, onClose } = open();
    await userEvent.click(item('Clear'));
    expect(onAction).toHaveBeenCalledWith('clear');
    // And closes, so a second choice cannot be made against a stale selection.
    expect(onClose).toHaveBeenCalled();
  });

  it('disables everything that acts on a selection when there is none', () => {
    open({ selection: noteSelection(0) });
    for (const name of ['Copy', 'Cut', 'Clear', 'Delete selection'])
      expect(item(name), name).toBeDisabled();
    // Select all needs no selection, by definition.
    expect(item('Select all notes')).toBeEnabled();
  });

  it('keeps Copy live while the transport plays, and nothing else', () => {
    // Copy only reads. The same exemption the edit lock makes everywhere else.
    open({ playing: true });
    expect(item('Copy')).toBeEnabled();
    for (const name of ['Cut', 'Clear', 'Delete selection'])
      expect(item(name), name).toBeDisabled();
  });

  it('offers Paste only when the clipboard holds the same kind of thing', () => {
    // `canPasteInto` is the rule; this is the menu obeying it. Pasting a track
    // over a run of notes has no meaning anybody could predict.
    open({ clipboard: null });
    expect(item('Paste')).toBeDisabled();
  });

  it('enables Paste when the kinds match', () => {
    open({ clipboard: NOTES_CLIPBOARD });
    expect(item('Paste')).toBeEnabled();
  });
});
