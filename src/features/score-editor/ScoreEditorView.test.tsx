import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { act, fireEvent, render } from '@testing-library/react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { stressScore, twinkleScore } from '@sudobility/music_lib';
import { computeLayout, caretPositionForTick, tickForPoint } from '@sudobility/music_lib';
import { allNotes, findEvent } from '@sudobility/music_lib';
import type { NoteEvent, Score } from '@sudobility/music_types';
import type { BBox, RenderTheme } from '@sudobility/music_lib';
import { CanvasScoreRenderer, createMock2DContext } from '@sudobility/music_lib';
import { extractFragment, playbackController } from '@sudobility/music_lib';
import type { ScoreFragment } from '@sudobility/music_lib';

// ScoreEditorView wires useEditorShortcuts(store) with no explicit
// controller, so it falls back to the app-wide `playbackController`
// singleton, which eagerly constructs a real Tone.js engine on import —
// mocked out here since this suite never exercises the Space shortcut.
vi.mock('@sudobility/music_lib', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  playbackController: { togglePlay: vi.fn(), seek: vi.fn() },
}));

import { ScoreEditorView } from '@/features/score-editor/ScoreEditorView';
import type { EditorStoreApi } from '@/features/score-editor/editing';

const THEME: RenderTheme = {
  foreground: 'rgba(0, 0, 0, 0.87)',
  selection: '#1565c0',
  playback: '#2e7d32',
  preview: '#ed6c02',
};

function makeStore(): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twinkleScore());
  return store;
}

/**
 * A reference render with an independent CanvasScoreRenderer against the
 * exact inputs the component uses in jsdom (zoom 1, page mode, the
 * DEFAULT_WIDTH 900 fallback since clientWidth is 0, and a tall viewport
 * so everything draws) — giving tests the same bbox maps the component
 * holds in its private resultRef. jsdom reports every DOM rect as 0, so a
 * click's clientX/clientY pass through as content coordinates directly.
 */
function referenceRender(score: Score) {
  return new CanvasScoreRenderer().render(score, createMock2DContext(), {
    zoom: 1,
    layoutMode: 'page',
    width: 900,
    theme: THEME,
    viewport: { top: 0, bottom: 1_000_000 },
  });
}

function center(box: BBox): { clientX: number; clientY: number } {
  return { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
}

function interactionSurface(): HTMLElement {
  return screen.getByTestId('score-editor-canvas');
}

/** Clicks the interaction surface at the center of `noteId`'s drawn bbox. */
function clickNote(score: Score, noteId: string, init: MouseEventInit = {}): void {
  const box = referenceRender(score).idToBBox.get(noteId);
  if (!box) throw new Error(`no bbox for note ${noteId}`);
  fireEvent.click(interactionSurface(), { ...center(box), ...init });
}

/** A point inside `measureId`'s stave box that is NOT inside any note bbox (so the click resolves to the measure, not a note). */
function measureFreePoint(score: Score, measureId: string): { clientX: number; clientY: number } {
  const result = referenceRender(score);
  const box = result.measureIdToBBox.get(measureId);
  if (!box) throw new Error(`no bbox for measure ${measureId}`);
  for (let dx = 1; dx < box.width; dx += 3) {
    for (let dy = 1; dy < box.height; dy += 3) {
      const p = { x: box.x + dx, y: box.y + dy };
      let insideNote = false;
      for (const noteBox of result.idToBBox.values()) {
        if (
          p.x >= noteBox.x &&
          p.x <= noteBox.x + noteBox.width &&
          p.y >= noteBox.y &&
          p.y <= noteBox.y + noteBox.height
        ) {
          insideNote = true;
          break;
        }
      }
      if (!insideNote) return { clientX: p.x, clientY: p.y };
    }
  }
  throw new Error(`no note-free point found in measure ${measureId}`);
}

/**
 * A regeneration-candidate-shaped `ScoreFragment` for the first measure of
 * `score`'s first track, with every id (measure/voice/event) rewritten to a
 * fresh value — mirroring what a real candidate's freshly-generated ids do
 * (C1 regression coverage: a candidate's ids never coincide with the
 * committed score's).
 */
function fakePreviewFragment(score: Score): ScoreFragment {
  const track = score.tracks[0];
  const measure = track.measures[0];
  const range = {
    startTick: measure.startTick,
    endTick: measure.startTick + measure.durationTicks,
    trackIds: [track.id],
  };
  const fragment = extractFragment(score, range);
  return {
    ...fragment,
    tracks: fragment.tracks.map((t) => ({
      ...t,
      measures: t.measures.map((m) => ({
        ...m,
        id: `${m.id}-preview`,
        voices: m.voices.map((v) => ({
          ...v,
          id: `${v.id}-preview`,
          events: v.events.map((e) => ({ ...e, id: `${e.id}-preview` })),
        })),
      })),
    })),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(playbackController.seek).mockClear();
});

describe('ScoreEditorView', () => {
  it('renders without a score loaded (empty state)', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(() => render(<ScoreEditorView store={store} />)).not.toThrow();
  });

  it('draws the score through CanvasScoreRenderer and records a bbox per note', () => {
    const store = makeStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    expect(renderSpy).toHaveBeenCalled();
    const result = renderSpy.mock.results.at(-1)!.value;
    for (const note of allNotes(store.getState().score!)) {
      expect(result.idToBBox.get(note.id)).toBeDefined();
    }
  });

  it('clicking a note selects it', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!);

    clickNote(store.getState().score!, first.id);

    expect(store.getState().selection.eventIds).toEqual([first.id]);
  });

  it('shift-clicking a second note adds it to the selection', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const [first, second] = allNotes(store.getState().score!);

    clickNote(store.getState().score!, first.id);
    clickNote(store.getState().score!, second.id, { shiftKey: true });

    expect(store.getState().selection.eventIds).toEqual([first.id, second.id]);
  });

  it('shift-clicking an already-selected note removes it (toggle)', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const [first, second] = allNotes(store.getState().score!);

    clickNote(store.getState().score!, first.id);
    clickNote(store.getState().score!, second.id, { shiftKey: true });
    clickNote(store.getState().score!, second.id, { shiftKey: true });

    expect(store.getState().selection.eventIds).toEqual([first.id]);
  });

  it('clicking a note-free spot on a stave selects that measure (and seeks)', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    const measureId = score.tracks[0].measures[0].id;

    fireEvent.click(interactionSurface(), measureFreePoint(score, measureId));

    expect(store.getState().selection).toEqual({
      eventIds: [],
      measureIds: [measureId],
      trackIds: [],
    });
    expect(playbackController.seek).toHaveBeenCalledTimes(1);
  });

  it('Escape clears the selection (composed with the toolbar and shortcuts hook)', async () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!);
    clickNote(store.getState().score!, first.id);
    expect(store.getState().selection.eventIds).toEqual([first.id]);

    await userEvent.setup().keyboard('{Escape}');

    expect(store.getState().selection.eventIds).toEqual([]);
  });

  it('Delete removes the selected note end-to-end', async () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!);
    clickNote(store.getState().score!, first.id);

    await userEvent.setup().keyboard('{Delete}');

    expect(findEvent(store.getState().score!, first.id)).toBeNull();
  });

  it('ArrowUp transposes the selected note up a semitone end-to-end', async () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!) as NoteEvent[];
    clickNote(store.getState().score!, first.id);

    await userEvent.setup().keyboard('{ArrowUp}');

    const updated = findEvent(store.getState().score!, first.id) as NoteEvent;
    expect(updated.pitch).toEqual({ step: 'C', accidental: 1, octave: 4 });
  });

  it('the toolbar duration control dispatches a duration change for the selected note', async () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!);
    clickNote(store.getState().score!, first.id);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Eighth note' }));

    const updated = findEvent(store.getState().score!, first.id);
    expect(updated?.durationTicks).toBe(store.getState().score!.ppq / 2);
  });

  it('redraws notation on score change, but only repaints the overlay on selection change', () => {
    const store = makeStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const rendersAfterMount = renderSpy.mock.calls.length;

    const [first] = allNotes(store.getState().score!);
    act(() => {
      store.getState().setSelection({ eventIds: [first.id], measureIds: [], trackIds: [] });
    });
    expect(renderSpy.mock.calls.length).toBe(rendersAfterMount); // overlay-only

    act(() => {
      store.getState().setScore(twinkleScore());
    });
    expect(renderSpy.mock.calls.length).toBeGreaterThan(rendersAfterMount); // notation redraw
  });
});

describe('ScoreEditorView: candidate preview (spec §13)', () => {
  it('draws the spliced preview score, so the fragment ids have bboxes', () => {
    const store = makeStore();
    const fragment = fakePreviewFragment(store.getState().score!);
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);

    act(() => {
      store.getState().setPreviewFragment(fragment);
    });

    const result = renderSpy.mock.results.at(-1)!.value;
    const previewEventId = fragment.tracks[0].measures[0].voices[0].events[0].id;
    expect(result.idToBBox.get(previewEventId)).toBeDefined();
  });

  it('ignores canvas clicks entirely while previewing (no selection, no seek)', () => {
    const store = makeStore();
    const score = store.getState().score!;
    const fragment = fakePreviewFragment(score);
    render(<ScoreEditorView store={store} />);
    act(() => {
      store.getState().setPreviewFragment(fragment);
    });

    const [first] = allNotes(score);
    clickNote(score, first.id);
    fireEvent.click(interactionSurface(), { clientX: 150, clientY: 60 });

    expect(store.getState().selection.eventIds).toEqual([]);
    expect(playbackController.seek).not.toHaveBeenCalled();
  });
});

describe('ScoreEditorView: windowed drawing (virtualization)', () => {
  function mockScrollGeometry(
    scrollBox: HTMLElement,
    clientHeight: number,
    scrollTop: number,
  ): void {
    Object.defineProperty(scrollBox, 'clientHeight', { value: clientHeight, configurable: true });
    Object.defineProperty(scrollBox, 'scrollTop', {
      value: scrollTop,
      configurable: true,
      writable: true,
    });
  }

  // The scroll handler throttles `draw` via requestAnimationFrame; stubbing
  // rAF to run synchronously keeps these tests deterministic while still
  // exercising the real scroll -> draw code path.
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const BIG_MEASURE_COUNT = 80;

  function makeBigStore(): EditorStoreApi {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(stressScore(1, BIG_MEASURE_COUNT)); // wraps into many systems at the default render width
    return store;
  }

  it('draws only the systems intersecting a short viewport', () => {
    const store = makeBigStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(200);

    render(<ScoreEditorView store={store} />);

    const result = renderSpy.mock.results.at(-1)!.value;
    expect(result.drawnMeasureIndices.size).toBeGreaterThan(0);
    expect(result.drawnMeasureIndices.size).toBeLessThan(BIG_MEASURE_COUNT);

    clientHeightSpy.mockRestore();
  }, 15_000);

  it('redraws the new window when the box scrolls (drawing IS the culling)', () => {
    const store = makeBigStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const scrollBox = getByTestId('score-editor-scroll');

    mockScrollGeometry(scrollBox, 200, 0);
    fireEvent.scroll(scrollBox);
    const topResult = renderSpy.mock.results.at(-1)!.value;

    mockScrollGeometry(scrollBox, 200, 5_000);
    fireEvent.scroll(scrollBox);
    const bottomResult = renderSpy.mock.results.at(-1)!.value;

    const topIndices = [...topResult.drawnMeasureIndices];
    const bottomIndices = [...bottomResult.drawnMeasureIndices];
    expect(Math.min(...bottomIndices)).toBeGreaterThan(Math.max(...topIndices) - topIndices.length);
    expect(bottomIndices).not.toEqual(topIndices);

    // The renderer receives the live scrolled viewport, in logical units.
    const lastOptions = renderSpy.mock.calls.at(-1)![2];
    expect(lastOptions.viewport.top).toBeCloseTo(5_000, 5);
  }, 15_000);

  it('re-sizes and redraws when the scroll box is resized without any scroll (refresh-render fix)', () => {
    let resizeCallback: (() => void) | null = null;
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        resizeCallback = () => cb([], this as unknown as ResizeObserver);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const store = makeBigStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const rendersBefore = renderSpy.mock.calls.length;

    mockScrollGeometry(getByTestId('score-editor-scroll'), 200, 0);
    act(() => resizeCallback?.());

    expect(renderSpy.mock.calls.length).toBeGreaterThan(rendersBefore);
    const result = renderSpy.mock.results.at(-1)!.value;
    expect(result.drawnMeasureIndices.size).toBeLessThan(BIG_MEASURE_COUNT);
  }, 15_000);
});

describe('ScoreEditorView: playback auto-scroll (spec §7 item 13)', () => {
  function mockScrollTo(el: HTMLElement) {
    const spy = vi.fn();
    Object.defineProperty(el, 'scrollTo', { value: spy, configurable: true, writable: true });
    return spy;
  }

  it('scrolls the scroll box to the active measure when playing', () => {
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const scrollToSpy = mockScrollTo(getByTestId('score-editor-scroll'));

    act(() => store.getState().setPlaybackState('playing'));

    expect(scrollToSpy).toHaveBeenCalled();
  });

  it('does not re-scroll for position changes within the same measure', () => {
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const scrollToSpy = mockScrollTo(getByTestId('score-editor-scroll'));

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
    const scrollToSpy = mockScrollTo(getByTestId('score-editor-scroll'));

    act(() => store.getState().setPlaybackState('playing'));

    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    vi.unstubAllGlobals();
  });
});

describe('playback caret and click-to-seek', () => {
  function caretPlan(store: EditorStoreApi) {
    // Same inputs the component uses in jsdom: zoom 1, page mode, and the
    // DEFAULT_WIDTH 900 fallback (clientWidth is 0 here).
    return computeLayout(store.getState().score!, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: THEME,
    });
  }

  it('shows the caret at the score start (tick 0) before any playback', () => {
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const caret = getByTestId('playback-caret');
    const expected = caretPositionForTick(caretPlan(store), store.getState().score!, 0)!;
    expect(caret.style.left).toBe(`${expected.x}px`);
  });

  it('moves the caret as positionTick advances', () => {
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const before = getByTestId('playback-caret').style.left;

    const m1 = store.getState().score!.tracks[0].measures[1];
    act(() => store.getState().setPositionTick(m1.startTick + Math.round(m1.durationTicks / 2)));

    expect(getByTestId('playback-caret').style.left).not.toBe(before);
  });

  it('clicking empty space inside a system seeks playback to the clicked tick', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    const measureId = score.tracks[0].measures[1].id;
    const point = measureFreePoint(score, measureId);

    fireEvent.click(interactionSurface(), point);

    const expected = tickForPoint(caretPlan(store), score, point.clientX, point.clientY);
    expect(playbackController.seek).toHaveBeenCalledWith(expected);
  });

  it('clicking a note selects it without moving the playback position', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const first = allNotes(store.getState().score!)[0];

    clickNote(store.getState().score!, first.id);

    expect(store.getState().selection.eventIds).toEqual([first.id]);
    expect(playbackController.seek).not.toHaveBeenCalled();
  });

  it('wraps the caret/spacer layout at the scroll box measured width, not the 900px fallback', () => {
    // Regression: layoutPlan once read containerRef.current?.clientWidth
    // inside a useMemo — null on first render, so it fell back to
    // DEFAULT_WIDTH (900) and never re-measured, while draw() wrapped at
    // the real width: the caret overshot each drawn line's end before
    // jumping to the next system. The spacer height is the observable
    // proxy for which width the caret's plan wrapped at.
    const widthSpy = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(500);
    try {
      const store = makeStore();
      render(<ScoreEditorView store={store} />);
      const score = store.getState().score!;
      const opts = { zoom: 1, layoutMode: 'page' as const, theme: THEME };
      const at500 = computeLayout(score, { ...opts, width: 500 }).totalHeight;
      const at900 = computeLayout(score, { ...opts, width: 900 }).totalHeight;
      expect(at500).not.toBe(at900); // precondition: the two widths wrap differently
      expect(interactionSurface().style.height).toBe(`${Math.max(at500, 400)}px`);
    } finally {
      widthSpy.mockRestore();
    }
  });
});

describe('ScoreEditorView: continuous-mode horizontal scrolling', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('nests the sticky canvas anchor inside the full-size interaction div (horizontal sticking needs a full-width containing block)', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const canvas = screen.getByTestId('score-canvas');
    expect(canvas.closest('[data-testid="score-editor-canvas"]')).not.toBeNull();
  });

  it('gives the spacer the full continuous-layout width so the box scrolls horizontally', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    fireEvent.click(screen.getByLabelText('Continuous layout'));

    const plan = computeLayout(store.getState().score!, {
      zoom: 1,
      layoutMode: 'continuous',
      width: 900,
      theme: THEME,
    });
    expect(plan.totalWidth).toBeGreaterThan(900); // precondition: wider than any viewport
    expect(interactionSurface().style.minWidth).toBe(`${plan.totalWidth}px`);
  });

  it('windows the draw horizontally from scrollLeft and redraws on horizontal scroll', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(stressScore(1, 80));
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    fireEvent.click(screen.getByLabelText('Continuous layout'));

    const scrollBox = screen.getByTestId('score-editor-scroll');
    Object.defineProperty(scrollBox, 'clientWidth', { value: 900, configurable: true });
    Object.defineProperty(scrollBox, 'scrollLeft', {
      value: 3000,
      configurable: true,
      writable: true,
    });
    fireEvent.scroll(scrollBox);

    const lastOptions = renderSpy.mock.calls.at(-1)![2];
    expect(lastOptions.viewport.left).toBe(3000);
    expect(lastOptions.viewport.right).toBe(3900);

    const result = renderSpy.mock.results.at(-1)!.value;
    expect(result.drawnMeasureIndices.size).toBeGreaterThan(0);
    expect(result.drawnMeasureIndices.size).toBeLessThan(80); // horizontal window, not the whole score
    expect(result.drawnMeasureIndices.has(0)).toBe(false); // measure 0 is far left of scrollLeft 3000
  });
});
