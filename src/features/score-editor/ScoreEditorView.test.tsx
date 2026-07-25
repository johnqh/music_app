import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import { stressScore, twinkleScore } from '@/test/fixtures';
import { computeLayout } from '@/adapters/vexflow/layout';
import { allNotes, findEvent } from '@/domain/score/queries';
import type { NoteEvent } from '@/domain/score/types';
import { VexFlowScoreRenderer } from '@/adapters/vexflow/renderer';

// ScoreEditorView wires useEditorShortcuts(store) with no explicit
// controller, so it falls back to the app-wide `playbackController`
// singleton, which eagerly constructs a real Tone.js engine on import —
// mocked out here since this suite never exercises the Space shortcut.
vi.mock('@/services/playback/controller', () => ({
  playbackController: { togglePlay: vi.fn() },
}));

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

  describe('virtualization (spec §26/§29): culls systems outside the scroll viewport', () => {
    // jsdom never lays anything out (`clientHeight` is always 0), which
    // ScoreEditorView treats as "viewport not measurable yet" and renders
    // everything (see `measureViewport`'s doc comment) - exactly what every
    // other test in this file relies on. These tests instead stub
    // `clientHeight`/`scrollTop` on the scrollable ancestor directly so a
    // real (non-zero) viewport measurement flows through `visibleSystemMeasureIndices`.
    function mockScrollGeometry(scrollBox: HTMLElement, clientHeight: number, scrollTop: number): void {
      Object.defineProperty(scrollBox, 'clientHeight', { value: clientHeight, configurable: true });
      Object.defineProperty(scrollBox, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
    }

    const BIG_MEASURE_COUNT = 80;

    function makeBigStore(): EditorStoreApi {
      dbCounter += 1;
      db = new ScoreSmithDb(`scoresmith-test-score-editor-view-virtualization-${dbCounter}`);
      const store = createAppStore({ db });
      store.getState().setScore(stressScore(1, BIG_MEASURE_COUNT)); // wraps into many systems at the default render width
      return store;
    }

    it(
      'renders every measure before the viewport has been measured',
      () => {
        const store = makeBigStore();
        const { container } = render(<ScoreEditorView store={store} />);
        const totalMeasures = store.getState().score!.tracks[0].measures.length;
        expect(container.querySelectorAll('.vf-stave').length).toBe(totalMeasures);
      },
      15_000,
    );

    it(
      'renders only measures near the top of a short viewport, and flips to the bottom set on scroll',
      () => {
        const store = makeBigStore();
        const score = store.getState().score!;
        const notes = allNotes(score);
        const firstNoteId = notes[0].id;
        const lastNoteId = notes[notes.length - 1].id;
        const totalMeasures = score.tracks[0].measures.length;

        // The real total logical-unit height, from the same layout the
        // component itself computes (page mode, DEFAULT_WIDTH's 900px
        // fallback since jsdom reports clientWidth 0) — used to pick a
        // scrollTop genuinely near the bottom of *this* score, rather than
        // an arbitrary huge number that could overshoot every system.
        const plan = computeLayout(score, {
          zoom: 1,
          layoutMode: 'page',
          width: 900,
          theme: { foreground: '#000', selection: '#00f', playback: '#f00', preview: '#999' },
        });

        const { container, getByTestId } = render(<ScoreEditorView store={store} />);
        const scrollBox = getByTestId('score-editor-scroll');

        mockScrollGeometry(scrollBox, 200, 0);
        fireEvent.scroll(scrollBox);

        const staveCountNearTop = container.querySelectorAll('.vf-stave').length;
        expect(staveCountNearTop).toBeGreaterThan(0);
        expect(staveCountNearTop).toBeLessThan(totalMeasures);
        expect(container.querySelector(`[id="vf-${firstNoteId}"]`)).not.toBeNull();
        expect(container.querySelector(`[id="vf-${lastNoteId}"]`)).toBeNull();

        mockScrollGeometry(scrollBox, 200, Math.max(0, plan.totalHeight - 200));
        fireEvent.scroll(scrollBox);

        expect(container.querySelector(`[id="vf-${lastNoteId}"]`)).not.toBeNull();
        expect(container.querySelector(`[id="vf-${firstNoteId}"]`)).toBeNull();
      },
      15_000,
    );
  });

  describe('scroll-into-view during playback', () => {
    // jsdom doesn't implement Element.prototype.scrollTo (see
    // ScoreEditorView.tsx's `typeof container.scrollTo === 'function'`
    // guard), so these tests install their own mock on the rendered canvas
    // element directly, after the initial render has populated a real
    // `measureIdToBBox` for the fixture's measures.
    function mockScrollTo(canvas: HTMLElement): ReturnType<typeof vi.fn> {
      const scrollToSpy = vi.fn();
      Object.assign(canvas, { scrollTo: scrollToSpy });
      return scrollToSpy;
    }

    it('re-fires the scroll on the same measure after a stop/restart (regression: lastScrolledMeasureRef must reset on stop)', () => {
      const store = makeStore();
      const { getByTestId } = render(<ScoreEditorView store={store} />);
      const scrollToSpy = mockScrollTo(getByTestId('score-editor-canvas'));

      // positionTick stays at its default (0) throughout -> always the same
      // first measure, so any second scroll call can only be explained by
      // the reset, not by a genuinely different measureId.
      act(() => store.getState().setPlaybackState('playing'));
      expect(scrollToSpy).toHaveBeenCalledTimes(1);

      act(() => store.getState().setPlaybackState('stopped'));
      expect(scrollToSpy).toHaveBeenCalledTimes(1); // stopping alone must not itself scroll

      act(() => store.getState().setPlaybackState('playing'));
      expect(scrollToSpy).toHaveBeenCalledTimes(2); // same measure, but must re-fire after the stop
    });

    it('does not re-fire while positionTick moves within the same measure during one playback run', () => {
      const store = makeStore();
      const { getByTestId } = render(<ScoreEditorView store={store} />);
      const scrollToSpy = mockScrollTo(getByTestId('score-editor-canvas'));

      act(() => store.getState().setPlaybackState('playing'));
      expect(scrollToSpy).toHaveBeenCalledTimes(1);

      // A small tick advance that's still within the same (first) measure.
      act(() => store.getState().setPositionTick(10));
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
    });

    it('uses instant ("auto") scroll behavior when the user prefers reduced motion', () => {
      const matchMediaSpy = vi.fn().mockReturnValue({ matches: true } as MediaQueryList);
      vi.stubGlobal('matchMedia', matchMediaSpy);

      const store = makeStore();
      const { getByTestId } = render(<ScoreEditorView store={store} />);
      const scrollToSpy = mockScrollTo(getByTestId('score-editor-canvas'));

      act(() => store.getState().setPlaybackState('playing'));

      expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
      vi.unstubAllGlobals();
    });
  });
});
