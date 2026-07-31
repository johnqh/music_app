import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { act, fireEvent, render } from '@testing-library/react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { stressScore, twinkleScore, twoTrackScore } from '@sudobility/music_lib';
import {
  TRACK_INFO_WIDTH,
  caretPositionForTick,
  computeLayout,
  tickForPoint,
} from '@sudobility/music_lib';
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
import { LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import type { EditorStoreApi } from '@/features/score-editor/editing';

// The component's own light theme, not a stand-in: reference renders below
// must wrap and color identically to what the component draws.
const THEME: RenderTheme = LIGHT_RENDER_THEME;

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

/**
 * Lets the colour repaint's `requestAnimationFrame` fire. Colour changes are
 * coalesced to one draw per frame (see `ScoreEditorView`'s repaint effect), so
 * assertions about what the renderer received have to wait a frame.
 */
async function flushRepaintFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
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
    // Only notes in the DRAWN WINDOW have bboxes -- that is the virtualization
    // working. Asserting all of them only passed while the whole score happened
    // to fit the viewport, which it no longer does now the track gutter takes
    // 220px of width and the score wraps into more systems.
    const score = store.getState().score!;
    const drawnNotes = allNotes(score).filter((note) => {
      const measure = score.tracks
        .find((t) => t.id === note.trackId)!
        .measures.find((m) => m.voices.some((v) => v.events.some((e) => e.id === note.id)))!;
      return result.drawnMeasureIndices.has(measure.index);
    });
    expect(drawnNotes.length).toBeGreaterThan(0);
    for (const note of drawnNotes) {
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

  it('clicking a note-free spot on a stave sets the caret and clears the selection', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    const measureId = score.tracks[0].measures[0].id;
    act(() => {
      store.getState().setSelection({
        eventIds: [allNotes(score)[0].id],
        measureIds: [],
        trackIds: [],
      });
    });

    fireEvent.click(interactionSurface(), measureFreePoint(score, measureId));

    // Measure selection moved to the gutter; a stave click is now a caret
    // placement, and clearing makes that caret the next cmd-click's anchor.
    expect(store.getState().selection.eventIds).toEqual([]);
    expect(store.getState().selection.measureIds).toEqual([]);
    expect(playbackController.seek).toHaveBeenCalledTimes(1);
  });

  it('clicking a stave makes that track active', () => {
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;

    fireEvent.click(interactionSurface(), measureFreePoint(score, score.tracks[1].measures[0].id));

    expect(store.getState().activeTrackId).toBe(score.tracks[1].id);
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

  it('redraws notation on a selection change, because note state is the glyph color now', async () => {
    // The highlight overlay is gone, so there is no "repaint highlights
    // without touching notation" path any more. This is cheap by design:
    // computeLayout is cached and NOT invalidated by a color change, so the
    // redraw is just the visible window.
    const store = makeStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const rendersAfterMount = renderSpy.mock.calls.length;

    const [first] = allNotes(store.getState().score!);
    act(() => {
      store.getState().setSelection({ eventIds: [first.id], measureIds: [], trackIds: [] });
    });
    await flushRepaintFrame();
    expect(renderSpy.mock.calls.length).toBeGreaterThan(rendersAfterMount);
  });

  it('passes the selected note to the renderer as `selected`', async () => {
    const store = makeStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!);

    act(() => {
      store.getState().setSelection({ eventIds: [first.id], measureIds: [], trackIds: [] });
    });

    await flushRepaintFrame();
    expect(renderSpy.mock.calls.at(-1)![2].noteColors?.get(first.id)).toBe('selected');
  });

  it('passes a regenerated selection to the renderer as `regenerated`', async () => {
    const store = makeStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!);

    act(() => {
      store.getState().setSelection({ eventIds: [first.id], measureIds: [], trackIds: [] });
      store.setState({ selectionRegenerated: true });
    });

    await flushRepaintFrame();
    expect(renderSpy.mock.calls.at(-1)![2].noteColors?.get(first.id)).toBe('regenerated');
  });

  it('passes sounding notes to the renderer as `playing`', async () => {
    const store = makeStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const [first] = allNotes(store.getState().score!);

    act(() => {
      store.getState().setActiveNoteIds([first.id]);
    });

    await flushRepaintFrame();
    expect(renderSpy.mock.calls.at(-1)![2].noteColors?.get(first.id)).toBe('playing');
  });

  it('passes the active track and selected measures to the renderer', async () => {
    const store = makeStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    const measureId = score.tracks[0].measures[0].id;

    act(() => {
      store.getState().selectMeasures([measureId]);
    });

    await flushRepaintFrame();
    const opts = renderSpy.mock.calls.at(-1)![2];
    expect(opts.activeTrackId).toBe(score.tracks[0].id);
    expect(opts.selectedMeasureIds?.has(measureId)).toBe(true);
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

  it('keeps the reader\'s vertical scroll instead of snapping back to track 1', () => {
    // The whole point of the change: following playback used to scroll to the
    // top of the new system, throwing whatever track the reader was watching
    // off the top of the viewport on every wrap.
    const store = makeStore();
    // A position provably inside the system playback starts in, so "same
    // system, leave the scroll alone" is what is under test here.
    const plan = computeLayout(store.getState().score!, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: LIGHT_RENDER_THEME,
    });
    const insideFirstSystem = Math.round(plan.systems[0].yTop + 1);

    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const scrollBox = getByTestId('score-editor-scroll');
    Object.defineProperty(scrollBox, 'scrollTop', {
      value: insideFirstSystem,
      configurable: true,
      writable: true,
    });
    const scrollToSpy = mockScrollTo(scrollBox);

    act(() => store.getState().setPlaybackState('playing'));

    // Old behaviour scrolled to track 1's stave — 0 here, once the margin is
    // subtracted — regardless of where the reader had scrolled to.
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: insideFirstSystem }),
    );
    expect(insideFirstSystem).toBeGreaterThan(0);
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
    const expected = caretPositionForTick(caretPlan(store), store.getState().score!, 0)!;
    // Positioned by transform, not `left`: animating a layout property forced
    // a layout pass on every update.
    expect(getByTestId('playback-caret').style.transform).toContain(`translate(${expected.x}px`);
  });

  it('hides the caret behind the pinned track-info gutter rather than drawing over it', () => {
    // The caret is an abspos child of the scroll box, so it scrolls with the
    // content and sits above the canvas — including above the gutter, which is
    // pinned to the viewport's left edge and painted over the sheet.
    // The scroll handler coalesces through rAF; run it inline so the assertion
    // does not depend on jsdom scheduling a frame.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const caret = getByTestId('playback-caret');
    const scrollBox = getByTestId('score-editor-scroll');
    expect(caret.style.visibility).toBe('');

    // Scroll the caret's content position in under the gutter.
    const x = caretPositionForTick(caretPlan(store), store.getState().score!, 0)!.x;
    Object.defineProperty(scrollBox, 'scrollLeft', {
      value: x - TRACK_INFO_WIDTH + 1,
      configurable: true,
      writable: true,
    });
    act(() => {
      scrollBox.dispatchEvent(new Event('scroll'));
    });

    expect(caret.style.visibility).toBe('hidden');
    vi.unstubAllGlobals();
  });

  it('moves the caret as positionTick advances', () => {
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const before = getByTestId('playback-caret').style.transform;

    const m1 = store.getState().score!.tracks[0].measures[1];
    act(() => store.getState().setPositionTick(m1.startTick + Math.round(m1.durationTicks / 2)));

    expect(getByTestId('playback-caret').style.transform).not.toBe(before);
  });

  it('never animates a layout property', () => {
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const m1 = store.getState().score!.tracks[0].measures[1];
    act(() => store.getState().setPositionTick(m1.startTick));

    // `left`/`top` stay pinned at the origin; all motion is in the transform.
    const caret = getByTestId('playback-caret');
    expect(caret.style.left).toBe('0px');
    expect(caret.style.top).toBe('0px');
  });

  it('interpolates between engine reports while playing, instead of stepping at 30Hz', async () => {
    // The engine samples position through Tone's lookahead scheduling loop, so
    // its 30Hz reports arrive in clumps rather than evenly. Without
    // interpolation the caret lurched with them.
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const m1 = store.getState().score!.tracks[0].measures[1];

    act(() => {
      store.getState().setPositionTick(m1.startTick);
      store.getState().setPlaybackState('playing');
    });
    const atAnchor = getByTestId('playback-caret').style.transform;

    // No new report — only frames elapsing. The caret must still have moved.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    expect(getByTestId('playback-caret').style.transform).not.toBe(atAnchor);
  });

  it('stops interpolating when playback pauses', async () => {
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const m1 = store.getState().score!.tracks[0].measures[1];
    act(() => {
      store.getState().setPositionTick(m1.startTick);
      store.getState().setPlaybackState('playing');
    });

    act(() => store.getState().setPlaybackState('paused'));
    const atPause = getByTestId('playback-caret').style.transform;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    expect(getByTestId('playback-caret').style.transform).toBe(atPause);
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

  it('clicking a note selects it and moves the caret to its start', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const first = allNotes(store.getState().score!)[0];

    clickNote(store.getState().score!, first.id);

    expect(store.getState().selection.eventIds).toEqual([first.id]);
    expect(playbackController.seek).toHaveBeenCalledWith(first.startTick);
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

describe('caret-anchored range selection (cmd-click)', () => {
  /** A point inside measure `index`'s gutter band, in client coordinates (jsdom rects are all zero, so content coords pass through). */
  function gutterPoint(score: Score, index: number): { clientX: number; clientY: number } {
    const plan = computeLayout(score, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: THEME,
    });
    const system = plan.systems.find((sys) => sys.measureIndices.includes(index));
    const box = plan.trackLayouts[0].measures.find((m) => m.measureIndex === index)?.box;
    if (!system || !box) throw new Error(`no gutter geometry for measure ${index}`);
    return {
      clientX: box.x + box.width / 2,
      clientY: (system.gutterTop + system.yTop) / 2,
    };
  }

  it('selects the notes between the caret and the click on the active track', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    const notes = allNotes(score);
    act(() => {
      store.getState().setPositionTick(notes[0].startTick);
      store.getState().setActiveTrack(score.tracks[0].id);
    });

    clickNote(score, notes[2].id, { metaKey: true });

    const selected = store.getState().selection.eventIds;
    expect(selected).toContain(notes[0].id);
    expect(selected).toContain(notes[1].id);
    // The range ends at the clicked *tick*, not the clicked note: clicking a
    // notehead's center lands slightly past that note's startTick, so it is
    // included. (The half-open boundary itself is covered against exact tick
    // values in range-select.test.ts.)
    expect(selected).toContain(notes[2].id);
    // ...and nothing beyond the click.
    expect(selected).not.toContain(notes[3].id);
  });

  it('does not move the caret, so the anchor can be extended repeatedly', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    const notes = allNotes(score);
    act(() => {
      store.getState().setPositionTick(notes[0].startTick);
    });
    vi.mocked(playbackController.seek).mockClear();

    clickNote(score, notes[2].id, { metaKey: true });

    expect(playbackController.seek).not.toHaveBeenCalled();
  });

  it('records an explicit range, so an empty span can still be regenerated', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    act(() => {
      store.getState().setPositionTick(0);
      store.getState().setActiveTrack(score.tracks[0].id);
    });

    clickNote(score, allNotes(score)[2].id, { metaKey: true });

    const range = store.getState().selection.range;
    expect(range).toBeDefined();
    expect(range!.startTick).toBe(0);
    expect(range!.trackIds).toEqual([score.tracks[0].id]);
  });

  it('stays on the active track by default', () => {
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    act(() => {
      store.getState().setPositionTick(0);
      store.getState().setActiveTrack(score.tracks[0].id);
    });

    clickNote(score, allNotes(score).filter((n) => n.trackId === score.tracks[0].id)[2].id, {
      metaKey: true,
    });

    for (const id of store.getState().selection.eventIds) {
      expect(findEvent(score, id)!.trackId).toBe(score.tracks[0].id);
    }
  });

  it('widens to every track with cmd-shift-click', () => {
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    act(() => {
      store.getState().setPositionTick(0);
      store.getState().setActiveTrack(score.tracks[0].id);
    });

    const target = allNotes(score).filter((n) => n.trackId === score.tracks[0].id).at(-1)!;
    clickNote(score, target.id, { metaKey: true, shiftKey: true });

    const tracksHit = new Set(
      store.getState().selection.eventIds.map((id) => findEvent(score, id)!.trackId),
    );
    expect(tracksHit.has(score.tracks[1].id)).toBe(true);
  });

  it('clicking the measure gutter selects that measure on the active track', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    act(() => {
      store.getState().setActiveTrack(score.tracks[0].id);
    });

    fireEvent.click(interactionSurface(), gutterPoint(score, 0));

    expect(store.getState().selection.measureIds).toEqual([score.tracks[0].measures[0].id]);
  });

  it('cmd-shift-clicking the gutter selects that measure on every track', () => {
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;

    fireEvent.click(interactionSurface(), {
      ...gutterPoint(score, 0),
      metaKey: true,
      shiftKey: true,
    });

    expect(store.getState().selection.measureIds).toEqual([
      score.tracks[0].measures[0].id,
      score.tracks[1].measures[0].id,
    ]);
  });

  it('gutter clicks do not move the caret', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    vi.mocked(playbackController.seek).mockClear();

    fireEvent.click(interactionSurface(), gutterPoint(score, 0));

    expect(playbackController.seek).not.toHaveBeenCalled();
  });
});

describe('playback repaint cost', () => {
  it('does not redraw when a note outside the drawn window changes', async () => {
    // The regression this guards: `activeNoteIds` fires on every note-on and
    // note-off, and a redraw rebuilds + re-formats every VexFlow object in the
    // window (~5ms). Unguarded, that starved Tone.js's scheduling on the same
    // thread and playback audibly hesitated.
    const store = makeStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const before = renderSpy.mock.calls.length;

    act(() => store.getState().setActiveNoteIds(['not-a-note-in-this-score']));
    await flushRepaintFrame();

    expect(renderSpy.mock.calls.length).toBe(before);
  });

  it('does not redraw when the colors resolve to the same visible state', async () => {
    const store = makeStore();
    const [first] = allNotes(store.getState().score!);
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);

    act(() => store.getState().setActiveNoteIds([first.id]));
    await flushRepaintFrame();
    const afterFirstPaint = renderSpy.mock.calls.length;

    // Same sounding set, a fresh array identity — a held chord reporting again.
    act(() => store.getState().setActiveNoteIds([first.id]));
    await flushRepaintFrame();

    expect(renderSpy.mock.calls.length).toBe(afterFirstPaint);
  });

  it('coalesces a burst of color changes into one redraw', async () => {
    const store = makeStore();
    const notes = allNotes(store.getState().score!);
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const before = renderSpy.mock.calls.length;

    act(() => {
      store.getState().setActiveNoteIds([notes[0].id]);
      store.getState().setActiveNoteIds([notes[1].id]);
      store.getState().setActiveNoteIds([notes[2].id]);
    });
    await flushRepaintFrame();

    expect(renderSpy.mock.calls.length).toBe(before + 1);
  });

  it('keeps the caret out of the parent render, so 30Hz position updates are cheap', async () => {
    const store = makeStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const before = renderSpy.mock.calls.length;

    act(() => {
      for (let i = 1; i <= 20; i += 1) store.getState().setPositionTick(i * 24);
    });
    await flushRepaintFrame();

    expect(renderSpy.mock.calls.length).toBe(before);
  });
});

describe('track gutter click', () => {
  /** A point inside `trackIndex`'s gutter cell, in client coordinates (jsdom rects are all zero, so these pass through). */
  function gutterPoint(store: EditorStoreApi, trackIndex: number) {
    const plan = computeLayout(store.getState().score!, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: THEME,
    });
    const box = plan.trackLayouts[trackIndex].measures[0].box;
    return { clientX: 20, clientY: box.y + box.height / 2 };
  }

  it('makes the clicked track active and selects it', () => {
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;

    fireEvent.click(interactionSurface(), gutterPoint(store, 1));

    expect(store.getState().activeTrackId).toBe(score.tracks[1].id);
    expect(store.getState().selection.trackIds).toEqual([score.tracks[1].id]);
  });

  it('does not move the caret: the gutter is not part of the timeline', () => {
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    render(<ScoreEditorView store={store} />);
    vi.mocked(playbackController.seek).mockClear();

    fireEvent.click(interactionSurface(), gutterPoint(store, 0));

    expect(playbackController.seek).not.toHaveBeenCalled();
  });

  it('leaves clicks right of the gutter to the stave handlers', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    vi.mocked(playbackController.seek).mockClear();

    // A note-free spot on the stave still seeks, as before.
    fireEvent.click(interactionSurface(), measureFreePoint(score, score.tracks[0].measures[0].id));

    expect(playbackController.seek).toHaveBeenCalled();
  });
});
