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
import type { SelectionKind } from '@sudobility/music_lib';

function open(overrides: Partial<React.ComponentProps<typeof ScoreContextMenu>> = {}) {
  const onAction = vi.fn();
  const onClose = vi.fn();
  render(
    <ScoreContextMenu
      x={10}
      y={10}
      kind="notes"
      count={1}
      canPaste={false}
      canEdit
      onAction={onAction}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onAction, onClose };
}

const item = (name: string) => screen.getByRole('menuitem', { name });

describe('the subject header', () => {
  it.each<[SelectionKind, number, string]>([
    ['track', 1, 'Track'],
    ['measures', 1, 'Bar'],
    ['measures', 4, 'Bars'],
    ['notes', 1, 'Note'],
    ['notes', 3, 'Notes'],
  ])('names %s (%i) as "%s"', (kind, count, label) => {
    open({ kind, count });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('says nothing when nothing is selected', () => {
    // A header with no subject would be a label for an empty statement.
    open({ kind: null, count: 0 });
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
    open({ kind: null, count: 0 });
    for (const name of ['Copy', 'Cut', 'Clear', 'Delete selection'])
      expect(item(name), name).toBeDisabled();
    // Select all needs no selection, by definition.
    expect(item('Select all notes')).toBeEnabled();
  });

  it('keeps Copy live while the transport plays, and nothing else', () => {
    // Copy only reads. The same exemption the edit lock makes everywhere else.
    open({ canEdit: false });
    expect(item('Copy')).toBeEnabled();
    for (const name of ['Cut', 'Clear', 'Delete selection'])
      expect(item(name), name).toBeDisabled();
  });

  it('offers Paste only when the clipboard holds the same kind of thing', () => {
    // `canPasteInto` is the rule; this is the menu obeying it. Pasting a track
    // over a run of notes has no meaning anybody could predict.
    open({ canPaste: false });
    expect(item('Paste')).toBeDisabled();
  });

  it('enables Paste when the kinds match', () => {
    open({ canPaste: true });
    expect(item('Paste')).toBeEnabled();
  });
});
