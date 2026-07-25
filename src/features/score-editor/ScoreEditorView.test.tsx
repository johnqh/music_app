import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import { twinkleScore } from '@/test/fixtures';
import { allNotes, findEvent } from '@/domain/score/queries';
import type { NoteEvent } from '@/domain/score/types';
import { VexFlowScoreRenderer } from '@/adapters/vexflow/renderer';
import { ScoreEditorView } from '@/features/score-editor/ScoreEditorView';
import type { EditorStoreApi } from '@/features/score-editor/editing';

let db: ScoreSmithDb;
let dbCounter = 0;

function makeStore(): EditorStoreApi {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-score-editor-view-${dbCounter}`);
  const store = createAppStore({ db });
  store.getState().setScore(twinkleScore());
  return store;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await db?.delete();
});

function noteGroup(container: HTMLElement, noteId: string): Element {
  const el = container.querySelector(`[id="vf-${noteId}"]`);
  if (!el) throw new Error(`No rendered element for note ${noteId}`);
  return el;
}

describe('ScoreEditorView', () => {
  it('renders without a score loaded (empty state)', () => {
    const store = createAppStore({ db: new ScoreSmithDb('scoresmith-test-score-editor-view-empty') });
    expect(() => render(<ScoreEditorView store={store} />)).not.toThrow();
  });

  it('renders a clickable SVG group for every note in the score', () => {
    const store = makeStore();
    const { container } = render(<ScoreEditorView store={store} />);
    const notes = allNotes(store.getState().score!);
    for (const note of notes) {
      expect(container.querySelector(`[id="vf-${note.id}"]`)).not.toBeNull();
    }
  });

  it('clicking a note selects it', () => {
    const store = makeStore();
    const { container } = render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!);

    fireEvent.click(noteGroup(container, first.id));

    expect(store.getState().selection.eventIds).toEqual([first.id]);
  });

  it('shift-clicking a second note adds it to the selection', () => {
    const store = makeStore();
    const { container } = render(<ScoreEditorView store={store} />);
    const [first, second] = allNotes(store.getState().score!);

    fireEvent.click(noteGroup(container, first.id));
    fireEvent.click(noteGroup(container, second.id), { shiftKey: true });

    expect(store.getState().selection.eventIds).toEqual([first.id, second.id]);
  });

  it('shift-clicking an already-selected note removes it (toggle)', () => {
    const store = makeStore();
    const { container } = render(<ScoreEditorView store={store} />);
    const [first, second] = allNotes(store.getState().score!);

    fireEvent.click(noteGroup(container, first.id));
    fireEvent.click(noteGroup(container, second.id), { shiftKey: true });
    fireEvent.click(noteGroup(container, second.id), { shiftKey: true });

    expect(store.getState().selection.eventIds).toEqual([first.id]);
  });

  it('clicking a measure stave selects that measure', () => {
    const store = makeStore();
    const { container } = render(<ScoreEditorView store={store} />);
    const measureId = store.getState().score!.tracks[0].measures[0].id;
    const measureGroup = container.querySelector(`[id="vf-${measureId}"]`);
    expect(measureGroup).not.toBeNull();

    fireEvent.click(measureGroup!);

    expect(store.getState().selection).toEqual({ eventIds: [], measureIds: [measureId], trackIds: [] });
  });

  it('Escape clears the selection (composed with the toolbar and shortcuts hook)', async () => {
    const store = makeStore();
    const { container } = render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!);
    fireEvent.click(noteGroup(container, first.id));
    expect(store.getState().selection.eventIds).toEqual([first.id]);

    await userEvent.setup().keyboard('{Escape}');

    expect(store.getState().selection.eventIds).toEqual([]);
  });

  it('Delete removes the selected note end-to-end', async () => {
    const store = makeStore();
    const { container } = render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!);
    fireEvent.click(noteGroup(container, first.id));

    await userEvent.setup().keyboard('{Delete}');

    expect(findEvent(store.getState().score!, first.id)).toBeNull();
  });

  it('ArrowUp transposes the selected note up a semitone end-to-end', async () => {
    const store = makeStore();
    const { container } = render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!) as NoteEvent[];
    fireEvent.click(noteGroup(container, first.id));

    await userEvent.setup().keyboard('{ArrowUp}');

    const updated = findEvent(store.getState().score!, first.id) as NoteEvent;
    expect(updated.pitch).toEqual({ step: 'C', accidental: 1, octave: 4 });
  });

  it('the toolbar duration control dispatches a duration change for the selected note', async () => {
    const store = makeStore();
    const { container } = render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!);
    fireEvent.click(noteGroup(container, first.id));

    await userEvent.setup().click(screen.getByRole('button', { name: 'Eighth note' }));

    const updated = findEvent(store.getState().score!, first.id);
    expect(updated?.durationTicks).toBe(store.getState().score!.ppq / 2);
  });

  it('re-renders on score change but only re-paints highlights (not a full re-render) on selection change', () => {
    const store = makeStore();
    const renderSpy = vi.spyOn(VexFlowScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const callsAfterMount = renderSpy.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    const [first] = allNotes(store.getState().score!);
    store.getState().setSelection({ eventIds: [first.id], measureIds: [], trackIds: [] });

    expect(renderSpy.mock.calls.length).toBe(callsAfterMount);
  });

  describe('drag-box selection', () => {
    // jsdom has no real layout engine, so `RenderResult.idToBBox` from a
    // genuine VexFlow render is all-zero (see hit-test.test.ts's doc
    // comment) — coordinates here come from a mocked `render()` returning
    // synthetic, non-zero bboxes, so the drag-box math itself
    // (`eventIdsInBox`, exercised for real by `handlePointerUp`) is under
    // test end-to-end rather than only at the pure-function level.
    function fakeTheme() {
      return { foreground: '#000', selection: '#00f', playback: '#f00', preview: '#999' };
    }

    it('selects every note whose bbox intersects the dragged box', () => {
      const store = makeStore();
      const divA = document.createElementNS('http://www.w3.org/2000/svg', 'g') as unknown as SVGElement;
      const divB = document.createElementNS('http://www.w3.org/2000/svg', 'g') as unknown as SVGElement;
      const fakeResult = {
        idToElement: new Map([
          ['a', divA],
          ['b', divB],
        ]),
        idToBBox: new Map([
          ['a', { x: 0, y: 0, width: 10, height: 10 }],
          ['b', { x: 50, y: 0, width: 10, height: 10 }],
        ]),
        measureIdToBBox: new Map(),
        height: 100,
        theme: fakeTheme(),
      };
      vi.spyOn(VexFlowScoreRenderer.prototype, 'render').mockReturnValue(fakeResult);

      const { getByTestId } = render(<ScoreEditorView store={store} />);
      const canvas = getByTestId('score-editor-canvas');

      fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
      fireEvent.pointerMove(canvas, { clientX: 60, clientY: 10, pointerId: 1 });
      fireEvent.pointerUp(canvas, { clientX: 60, clientY: 10, pointerId: 1 });

      expect(new Set(store.getState().selection.eventIds)).toEqual(new Set(['a', 'b']));
    });

    it('a small pointerdown/up without movement does not clear or replace an existing selection', () => {
      const store = makeStore();
      const divA = document.createElementNS('http://www.w3.org/2000/svg', 'g') as unknown as SVGElement;
      const fakeResult = {
        idToElement: new Map([['a', divA]]),
        idToBBox: new Map([['a', { x: 0, y: 0, width: 10, height: 10 }]]),
        measureIdToBBox: new Map(),
        height: 100,
        theme: fakeTheme(),
      };
      vi.spyOn(VexFlowScoreRenderer.prototype, 'render').mockReturnValue(fakeResult);
      const [note] = allNotes(store.getState().score!);
      store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

      const { getByTestId } = render(<ScoreEditorView store={store} />);
      const canvas = getByTestId('score-editor-canvas');

      fireEvent.pointerDown(canvas, { clientX: 200, clientY: 200, button: 0, pointerId: 2 });
      fireEvent.pointerUp(canvas, { clientX: 200, clientY: 200, pointerId: 2 });

      expect(store.getState().selection.eventIds).toEqual([note.id]);
    });
  });
});
