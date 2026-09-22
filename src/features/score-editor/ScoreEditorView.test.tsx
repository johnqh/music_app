import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMusicPosition, getMusicPositionSource } from '@sudobility/music_types';
import { testStoreContext } from '@/app-library';
import { act, fireEvent, render } from '@testing-library/react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@/app-library';
import { stressScore, threeTrackScore, twinkleScore, twoTrackScore } from '@/app-library';
import {
  TRACK_INFO_WIDTH,
  caretPositionForTick,
  computeLayout,
  pitchToMidi,
  tickForPoint,
} from '@/app-library';
import { allNotes, findEvent, shiftDiatonic, writtenScore } from '@/app-library';
import { scoreWithPitch } from '@/app-library';
import type { NoteEvent, Score } from '@sudobility/music_types';
import type { BBox, RenderTheme } from '@/app-library';
import { CanvasScoreRenderer, createMock2DContext } from '@/app-library';
import { selectActiveTrackId } from '@/app-library';
import { playbackController } from '@/app-library';

// ScoreEditorView wires useEditorShortcuts(store) with no explicit
// controller, so it falls back to the app-wide `playbackController`
// singleton, which eagerly constructs a real Tone.js engine on import —
// mocked out here since this suite never exercises the Space shortcut.
vi.mock('@/app-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app-library')>();
  return {
    ...actual,
    // A real bus: the caret and the colour repaint both subscribe to it, and
    // these tests drive it directly in place of the old store field.
    playbackController: {
      togglePlay: vi.fn(),
      seek: vi.fn(),
      // The canvas reports how long lit notes take to draw; the player takes it.
      setSoundingRenderDelay: vi.fn(),
      bus: new actual.PlaybackBus(),
    },
  };
});

import { ScoreEditorView } from '@/features/score-editor/ScoreEditorView';

/**
 * What a seek actually does in the app.
 *
 * One line, because there is one position: moving it *is* moving the caret,
 * and whatever is playing follows it. This used to write a store field and
 * publish on the bus, because the caret and the playhead were two values that
 * had to be kept in step by hand.
 */
function seekTo(tick: number): void {
  getMusicPositionSource().moveTo(tick);
}

/**
 * The transport changing state, as the player reports it.
 *
 * Two writes, because the app has two readers: the store's `state` is what the
 * toolbar and the edit lock read, and the shared position's `isPlaying` is what
 * the playback binding moves the caret and follows the music by. The player
 * writes both from one engine callback; a test that set only the store would be
 * a transport the canvas never heard start.
 */
function setTransport(store: EditorStoreApi, state: 'playing' | 'paused' | 'stopped'): void {
  store.getState().setPlaybackState(state);
  getMusicPositionSource().setPlaying(state === 'playing');
}
import { DARK_RENDER_THEME, LIGHT_RENDER_THEME } from '@sudobility/music_drawing';
import type { EditorStoreApi } from '@/app-library';

// The component's own light theme, not a stand-in: reference renders below
// must wrap and color identically to what the component draws.
const THEME: RenderTheme = LIGHT_RENDER_THEME;

function makeStore(score: Score = twinkleScore()): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(score);
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

/**
 * A point in the measure-number gutter above `index`'s bar — the one gesture
 * that selects measures.
 */
function gutterPoint(score: Score, index: number): { clientX: number; clientY: number } {
  const result = referenceRender(score);
  const system = result.plan.systems.find((sys) => sys.measureIndices.includes(index));
  const box = result.measureIdToBBox.get(score.tracks[0].measures[index].id);
  if (!system || !box) throw new Error(`no gutter for measure ${index}`);
  return { clientX: box.x + box.width / 2, clientY: system.gutterTop + 4 };
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

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(playbackController.seek).mockClear();
  // The mocked bus is module-scoped, so it outlives a test the way the store
  // does not. Without this, one test's playhead is the next one's starting
  // position.
  playbackController.bus.publishPosition(0);
  playbackController.bus.publishSounding([]);
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

  it('does not let a drag with no synthetic click swallow the next note click', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    const first = allNotes(score)[0]!;
    const box = referenceRender(score).idToBBox.get(first.id)!;
    const from = center(box);
    const surface = interactionSurface();

    fireEvent.pointerDown(surface, { ...from, button: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, {
      clientX: from.clientX + 20,
      clientY: from.clientY + 20,
      pointerId: 1,
    });
    fireEvent.pointerUp(surface, {
      clientX: from.clientX + 20,
      clientY: from.clientY + 20,
      pointerId: 1,
    });

    clickNote(score, first.id);

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
    expect(getMusicPosition().reportedTick).toBeGreaterThanOrEqual(0);
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

    // The six duration toggles are one control now.
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Note duration'));
    await user.click(await screen.findByRole('option', { name: /Eighth/ }));

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
      playbackController.bus.publishSounding([
        { noteId: first.id, trackId: first.trackId, midi: 60 },
      ]);
    });

    await flushRepaintFrame();
    expect(renderSpy.mock.calls.at(-1)![2].noteColors?.get(first.id)).toBe('playing');
  });

  it('does not highlight a sounding note on an inactive track', async () => {
    // Every track's sounding notes used to light up. On a large score that
    // scatters colour across whichever parts happen to be sounding, which reads
    // as random rather than as a playhead — and the track you are actually
    // reading goes dark whenever it rests.
    const store = makeStore(twoTrackScore());
    const score = store.getState().score!;
    act(() => store.getState().setActiveTrack(score.tracks[0].id));
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const other = allNotes(score).find((n) => n.trackId === score.tracks[1].id)!;

    act(() => {
      playbackController.bus.publishSounding([
        { noteId: other.id, trackId: other.trackId, midi: 60 },
      ]);
    });

    await flushRepaintFrame();
    expect(renderSpy.mock.calls.at(-1)![2].noteColors?.get(other.id)).toBeUndefined();
  });

  it('highlights a sounding note on the active track, and follows a track change', async () => {
    const store = makeStore(twoTrackScore());
    const score = store.getState().score!;
    act(() => store.getState().setActiveTrack(score.tracks[1].id));
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const onTrackTwo = allNotes(score).find((n) => n.trackId === score.tracks[1].id)!;

    act(() => {
      playbackController.bus.publishSounding([
        { noteId: onTrackTwo.id, trackId: onTrackTwo.trackId, midi: 60 },
      ]);
    });
    await flushRepaintFrame();
    expect(renderSpy.mock.calls.at(-1)![2].noteColors?.get(onTrackTwo.id)).toBe('playing');

    // Switching tracks re-colours without any new report from the engine.
    act(() => store.getState().setActiveTrack(score.tracks[0].id));
    await flushRepaintFrame();
    expect(renderSpy.mock.calls.at(-1)![2].noteColors?.get(onTrackTwo.id)).toBeUndefined();
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

describe('ScoreEditorView: readOnly (the published-snapshot page)', () => {
  it('does not render the editing toolbar', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} readOnly />);
    // The toolbar's zoom-in control is as good a stand-in as any of its
    // buttons for "the toolbar is not here at all".
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('still draws the score', () => {
    const store = makeStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} readOnly />);
    expect(renderSpy).toHaveBeenCalled();
  });

  it('draws every track the same colour, even though the store still resolves a first active one', () => {
    // `selectActiveTrackId` falls back to the first visible track whenever
    // nothing was explicitly made active (music_editing's selectors.ts) — an
    // editor needs something to put a new note on. This page has no such
    // concept, and forwarding that fallback would dim every track but the
    // first one, exactly as it did before this guard existed.
    const store = makeStore(twoTrackScore());
    expect(selectActiveTrackId(store.getState())).not.toBeNull();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} readOnly />);
    const opts = renderSpy.mock.calls.at(-1)![2];
    expect(opts.activeTrackId).toBeNull();
  });

  it('a click on a note does not select it', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} readOnly />);
    const [first] = allNotes(store.getState().score!);

    clickNote(store.getState().score!, first.id);

    expect(store.getState().selection.eventIds).toEqual([]);
  });

  it('a drag over the score does not start a box selection', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} readOnly />);
    const score = store.getState().score!;
    const first = allNotes(score)[0]!;
    const box = referenceRender(score).idToBBox.get(first.id)!;
    const from = center(box);
    const surface = interactionSurface();

    fireEvent.pointerDown(surface, { ...from, button: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, {
      clientX: from.clientX + 40,
      clientY: from.clientY + 40,
      pointerId: 1,
    });
    fireEvent.pointerUp(surface, {
      clientX: from.clientX + 40,
      clientY: from.clientY + 40,
      pointerId: 1,
    });

    expect(screen.queryByTestId('drag-selection-box')).not.toBeInTheDocument();
    expect(store.getState().selection.eventIds).toEqual([]);
  });

  it('right-click does not open the context menu', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} readOnly />);
    const [first] = allNotes(store.getState().score!);
    const box = referenceRender(store.getState().score!).idToBBox.get(first.id)!;

    fireEvent.contextMenu(interactionSurface(), center(box));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('a keyboard shortcut (Delete) does not edit the score', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} readOnly />);
    const [first] = allNotes(store.getState().score!);
    const before = allNotes(store.getState().score!).length;
    act(() => {
      store.getState().setSelection({ eventIds: [first.id], measureIds: [], trackIds: [] });
    });

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(allNotes(store.getState().score!).length).toBe(before);
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

  /**
   * A score long enough to wrap, in a viewport short enough that following it
   * has to move. Scrolling only happens when the music is not already on
   * screen, so a test that wants a scroll has to arrange for one — a measure
   * the reader can already see is deliberately left alone.
   */
  function playingOffScreen() {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(stressScore(1, 40));
    const view = render(<ScoreEditorView store={store} />);
    const box = view.getByTestId('score-editor-scroll');
    Object.defineProperty(box, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(box, 'scrollTop', { value: 0, configurable: true, writable: true });
    // The canvas reads the view's size from the scroll box's events, as in a
    // browser; jsdom has no layout to fire one.
    fireEvent.scroll(box);
    const plan = computeLayout(store.getState().score!, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: THEME,
    });
    // The first measure of a system well below a 200px-tall viewport.
    const offScreenMeasure = plan.systems[3].measureIndices[0];
    const tick = store.getState().score!.tracks[0].measures[offScreenMeasure].startTick;
    return { store, box, tick, view };
  }

  it('scrolls the scroll box to the active measure when it is not already on screen', async () => {
    const { store, box, tick } = playingOffScreen();
    const scrollToSpy = mockScrollTo(box);

    await act(async () => setTransport(store, 'playing'));
    await act(async () => seekTo(tick));

    expect(scrollToSpy).toHaveBeenCalled();
  });

  it('does not re-scroll for position changes within the same measure', async () => {
    const { store, box, tick } = playingOffScreen();
    const scrollToSpy = mockScrollTo(box);

    await act(async () => setTransport(store, 'playing'));
    await act(async () => seekTo(tick));
    expect(scrollToSpy).toHaveBeenCalledTimes(1);

    // A small tick advance that's still within the same measure.
    await act(async () => seekTo(tick + 10));
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the reader's vertical scroll instead of snapping back to track 1", async () => {
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

    await act(async () => setTransport(store, 'playing'));

    // Nothing to do: the music is in the system the reader is already looking
    // at, and any scrollTo here would cancel a smooth scroll still in flight.
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(insideFirstSystem).toBeGreaterThan(0);
  });

  it('uses instant ("auto") scroll behavior when the user prefers reduced motion', async () => {
    // A whole MediaQueryList, listeners included: the colour scheme subscribes
    // to the same `matchMedia` to follow an OS flip.
    const matchMediaSpy = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList);
    vi.stubGlobal('matchMedia', matchMediaSpy);

    const { store, box, tick } = playingOffScreen();
    const scrollToSpy = mockScrollTo(box);

    await act(async () => setTransport(store, 'playing'));
    await act(async () => seekTo(tick));

    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    vi.unstubAllGlobals();
  });
});

describe('playback caret and click-to-seek', () => {
  /*
    The note positions the component's own caret is using.

    Both `caretPositionForTick` and `tickForPoint` interpolate between the
    noteheads VexFlow drew, not across the stave box — so an oracle that omits
    them is computing the *old* geometry and disagrees by the width of the
    clef. `referenceRender` draws the same window the component does, which is
    where they come from.
  */
  function caretPositions(store: EditorStoreApi) {
    return referenceRender(store.getState().score!).measureNotePositions;
  }

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

  it('shows the caret at the score start (tick 0) before any playback', async () => {
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    /*
      A frame, because the caret's exact x is not knowable until the canvas has
      drawn: it interpolates between the note positions the renderer records
      while building a measure, and a child's effects run before its parent's.
      The caret paints once from the stave box and corrects itself on the next
      frame — see `PlaybackCaret`.
    */
    await flushRepaintFrame();
    const expected = caretPositionForTick(
      caretPlan(store),
      store.getState().score!,
      0,
      caretPositions(store),
    )!;
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
    const x = caretPositionForTick(
      caretPlan(store),
      store.getState().score!,
      0,
      caretPositions(store),
    )!.x;
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

  it('moves the caret as positionTick advances', async () => {
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const before = getByTestId('playback-caret').style.transform;

    const m1 = store.getState().score!.tracks[0].measures[1];
    await act(async () => seekTo(m1.startTick + Math.round(m1.durationTicks / 2)));

    expect(getByTestId('playback-caret').style.transform).not.toBe(before);
  });

  it('never animates a layout property', async () => {
    const store = makeStore();
    const { getByTestId } = render(<ScoreEditorView store={store} />);
    const m1 = store.getState().score!.tracks[0].measures[1];
    await act(async () => seekTo(m1.startTick));

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

    await act(async () => {
      seekTo(m1.startTick);
      setTransport(store, 'playing');
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
    await act(async () => {
      seekTo(m1.startTick);
      setTransport(store, 'playing');
    });

    await act(async () => setTransport(store, 'paused'));
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

    const expected = tickForPoint(
      caretPlan(store),
      score,
      point.clientX,
      point.clientY,
      caretPositions(store),
    );
    expect(getMusicPosition().reportedTick).toBe(expected);
  });

  it('clicking a note selects it and moves the caret to its start', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const first = allNotes(store.getState().score!)[0];

    clickNote(store.getState().score!, first.id);

    expect(store.getState().selection.eventIds).toEqual([first.id]);
    expect(getMusicPosition().reportedTick).toBe(first.startTick);
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
      seekTo(notes[0].startTick);
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
      seekTo(notes[0].startTick);
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
      seekTo(0);
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
      seekTo(0);
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
      seekTo(0);
      store.getState().setActiveTrack(score.tracks[0].id);
    });

    const target = allNotes(score)
      .filter((n) => n.trackId === score.tracks[0].id)
      .at(-1)!;
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

    act(() =>
      playbackController.bus.publishSounding([
        { noteId: 'not-a-note-in-this-score', trackId: 'nope', midi: 60 },
      ]),
    );
    await flushRepaintFrame();

    expect(renderSpy.mock.calls.length).toBe(before);
  });

  it('DOES repaint a sounding note inside the window, and marks it playing', async () => {
    // The positive case this describe was missing. Both other tests assert a
    // redraw is *skipped*, so a change that stopped playing notes colouring
    // altogether would have left them green — which is exactly what happened
    // when `activeNoteIds` moved off the render path.
    const store = makeStore();
    const [first] = allNotes(store.getState().score!);
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const before = renderSpy.mock.calls.length;

    act(() =>
      playbackController.bus.publishSounding([
        { noteId: first.id, trackId: first.trackId, midi: 60 },
      ]),
    );
    await flushRepaintFrame();

    expect(renderSpy.mock.calls.length).toBeGreaterThan(before);
    const options = renderSpy.mock.calls.at(-1)?.[2] as
      { noteColors?: Map<string, string> } | undefined;
    expect(options?.noteColors?.get(first.id)).toBe('playing');
  });

  it('clears the playing colour when the note stops', async () => {
    const store = makeStore();
    const [first] = allNotes(store.getState().score!);
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);

    act(() =>
      playbackController.bus.publishSounding([
        { noteId: first.id, trackId: first.trackId, midi: 60 },
      ]),
    );
    await flushRepaintFrame();
    act(() => playbackController.bus.publishSounding([]));
    await flushRepaintFrame();

    const options = renderSpy.mock.calls.at(-1)?.[2] as
      { noteColors?: Map<string, string> } | undefined;
    expect(options?.noteColors?.get(first.id)).not.toBe('playing');
  });

  it('does not redraw when the colors resolve to the same visible state', async () => {
    const store = makeStore();
    const [first] = allNotes(store.getState().score!);
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);

    act(() =>
      playbackController.bus.publishSounding([
        { noteId: first.id, trackId: first.trackId, midi: 60 },
      ]),
    );
    await flushRepaintFrame();
    const afterFirstPaint = renderSpy.mock.calls.length;

    // Same sounding set, a fresh array identity — a held chord reporting again.
    act(() =>
      playbackController.bus.publishSounding([
        { noteId: first.id, trackId: first.trackId, midi: 60 },
      ]),
    );
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
      for (const n of notes.slice(0, 3)) {
        playbackController.bus.publishSounding([{ noteId: n.id, trackId: n.trackId, midi: 60 }]);
      }
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
      for (let i = 1; i <= 20; i += 1) seekTo(i * 24);
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
    getMusicPositionSource().moveTo(99999);

    // A note-free spot on the stave still moves the caret, as before.
    fireEvent.click(interactionSurface(), measureFreePoint(score, score.tracks[0].measures[0].id));

    expect(getMusicPosition().reportedTick).not.toBe(99999);
  });
});

describe('right-click selects what is under it, then opens the menu', () => {
  /*
    The one failure this shape must not have: a menu that opens over one thing
    and acts on another. It names its subject and Delete means three different
    edits, so opening it over bar 40 while bar 3 is selected would quietly
    delete the wrong bar.
  */
  function gutterCell(store: EditorStoreApi, trackIndex: number) {
    const plan = computeLayout(store.getState().score!, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: THEME,
    });
    const box = plan.trackLayouts[trackIndex].measures[0].box;
    return { clientX: 20, clientY: box.y + box.height / 2 };
  }

  const menu = () => screen.queryByRole('menu', { name: 'Score actions' });

  it('selects the track under it and says so', () => {
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;

    fireEvent.contextMenu(interactionSurface(), gutterCell(store, 1));

    expect(store.getState().selection.trackIds).toEqual([score.tracks[1].id]);
    expect(within(menu()!).getByText('Track')).toBeInTheDocument();
  });

  it('selects the bar under it and says so', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;

    fireEvent.contextMenu(interactionSurface(), gutterPoint(score, 1));

    expect(store.getState().selection.measureIds.length).toBeGreaterThan(0);
    expect(within(menu()!).getByText('Bar')).toBeInTheDocument();
  });

  it('selects the note under it and says so', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    const note = allNotes(score)[0];
    const box = referenceRender(score).idToBBox.get(note.id)!;

    fireEvent.contextMenu(interactionSurface(), center(box));

    expect(store.getState().selection.eventIds).toContain(note.id);
    expect(within(menu()!).getByText('Note')).toBeInTheDocument();
  });

  it('keeps a selection the click falls inside, rather than narrowing to one bar', () => {
    // Right-clicking one of four selected bars means those four. Narrowing is
    // the classic way a context menu throws away the selection just built.
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    const ids = [0, 1, 2].map((i) => score.tracks[0].measures[i].id);
    act(() => {
      store.getState().selectMeasures(ids);
    });

    fireEvent.contextMenu(interactionSurface(), gutterPoint(score, 1));

    expect(store.getState().selection.measureIds).toEqual(ids);
    expect(within(menu()!).getByText('Bars')).toBeInTheDocument();
  });
});

describe('drag a selected note to change its pitch', () => {
  /** Presses at `noteId`'s drawn centre, drags by `dy`, releases. */
  function dragNote(score: Score, noteId: string, dy: number): void {
    const box = referenceRender(score).idToBBox.get(noteId);
    if (!box) throw new Error(`no bbox for note ${noteId}`);
    const from = center(box);
    const surface = interactionSurface();
    fireEvent.pointerDown(surface, { ...from, button: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, {
      clientX: from.clientX,
      clientY: from.clientY + dy,
      pointerId: 1,
    });
    fireEvent.pointerUp(surface, {
      clientX: from.clientX,
      clientY: from.clientY + dy,
      pointerId: 1,
    });
  }

  it('moves the note by staff positions and is one undoable command', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    render(<ScoreEditorView store={store} />);
    const undoBefore = store.getState().canUndo;

    dragNote(store.getState().score!, note.id, -10); // up two positions

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.pitch).not.toEqual(note.pitch);
    expect(store.getState().canUndo).toBe(true);
    expect(undoBefore).toBe(false);

    // One command for the whole gesture: undo restores the pitch it had before
    // the drag, rather than stepping back through every position it crossed.
    act(() => store.getState().undo());
    expect((findEvent(store.getState().score!, note.id) as NoteEvent).pitch).toEqual(note.pitch);
  });

  it('drags down as well as up', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    render(<ScoreEditorView store={store} />);

    dragNote(store.getState().score!, note.id, 10);

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(pitchToMidi(updated.pitch)).toBeLessThan(pitchToMidi(note.pitch));
  });

  it('does nothing when the drag never crosses a staff position', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    render(<ScoreEditorView store={store} />);

    dragNote(store.getState().score!, note.id, 1);

    expect((findEvent(store.getState().score!, note.id) as NoteEvent).pitch).toEqual(note.pitch);
    expect(store.getState().canUndo).toBe(false);
  });

  it('stays a box select when the note under the pointer is not the selection', () => {
    // Requiring the note to be selected first is what keeps an ordinary
    // click-and-drag across the staff a selection box.
    const store = makeStore();
    const notes = allNotes(store.getState().score!) as NoteEvent[];
    store.getState().setSelection({ eventIds: [notes[1].id], measureIds: [], trackIds: [] });
    render(<ScoreEditorView store={store} />);

    dragNote(store.getState().score!, notes[0].id, -10);

    expect((findEvent(store.getState().score!, notes[0].id) as NoteEvent).pitch).toEqual(
      notes[0].pitch,
    );
  });

  it('stays a box select when more than one note is selected', () => {
    const store = makeStore();
    const notes = allNotes(store.getState().score!) as NoteEvent[];
    store
      .getState()
      .setSelection({ eventIds: [notes[0].id, notes[1].id], measureIds: [], trackIds: [] });
    render(<ScoreEditorView store={store} />);

    dragNote(store.getState().score!, notes[0].id, -10);

    expect((findEvent(store.getState().score!, notes[0].id) as NoteEvent).pitch).toEqual(
      notes[0].pitch,
    );
  });
});

describe('following the OS colour scheme', () => {
  it('redraws in the dark theme when the OS flips while the app is set to system', () => {
    // VexFlow paints literal colours, so the Tailwind `dark` class on <html>
    // following the OS is not enough: in system mode `themeMode` does not change
    // when the OS does, and a theme resolved from it alone kept the old colours.
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media),
    );
    try {
      const store = makeStore();
      act(() => store.getState().setThemeMode('system'));
      render(<ScoreEditorView store={store} />);
      const caret = screen.getByTestId('playback-caret');
      expect(caret).toHaveStyle({ backgroundColor: LIGHT_RENDER_THEME.caret });

      act(() => {
        media.matches = true;
        for (const listener of listeners) listener();
      });

      expect(caret).toHaveStyle({ backgroundColor: DARK_RENDER_THEME.caret });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Option-press on a note starts a move', () => {
  it('selects the pressed note and leaves the caret and the active track alone', () => {
    // A move is about which notes, like a box select. Aiming the caret or
    // switching the active track on the press would yank the playhead to
    // wherever a drag happened to start — the web never did either.
    const store = makeStore(twoTrackScore());
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;
    const [first, second] = score.tracks;
    // A treble note pressed while the bass is active: the bass part's whole
    // notes hang on ledger lines below the stave, outside any bar's box.
    const note = allNotes(score).find((n) => n.trackId === first.id && n.startTick > 0)!;
    act(() => {
      seekTo(0);
      store.getState().setActiveTrack(second.id);
    });
    const box = referenceRender(score).idToBBox.get(note.id)!;

    fireEvent.pointerDown(interactionSurface(), {
      ...center(box),
      button: 0,
      pointerId: 1,
      altKey: true,
    });

    expect(store.getState().selection.eventIds).toContain(note.id);
    expect(getMusicPosition().reportedTick).toBe(0);
    expect(store.getState().activeTrackId).toBe(second.id);
  });
});

describe('ScoreEditorView visible tracks', () => {
  function threeTrackStore(): EditorStoreApi {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(threeTrackScore());
    return store;
  }

  /** The tracks the last frame was actually laid out against. */
  function drawnTrackIds(spy: ReturnType<typeof vi.spyOn>): string[] {
    const result = spy.mock.results.at(-1)!.value as { plan: { tracks: Array<{ id: string }> } };
    return result.plan.tracks.map((track) => track.id);
  }

  it('lays out every track when nothing is hidden', () => {
    const store = threeTrackStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    expect(drawnTrackIds(renderSpy)).toEqual(store.getState().score!.tracks.map((t) => t.id));
  });

  it('lays out only the visible tracks', () => {
    const store = threeTrackStore();
    const [first, second, third] = store.getState().score!.tracks;
    store.getState().setVisibleTracks([first.id, third.id]);

    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);

    const drawn = drawnTrackIds(renderSpy);
    expect(drawn).toEqual([first.id, third.id]);
    expect(drawn).not.toContain(second.id);
  });

  it('redraws when a track is hidden while mounted', () => {
    const store = threeTrackStore();
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<ScoreEditorView store={store} />);
    const [first] = store.getState().score!.tracks;

    act(() => store.getState().setVisibleTracks([first.id]));

    expect(drawnTrackIds(renderSpy)).toEqual([first.id]);
  });
});

describe('written-pitch display', () => {
  /** A one-track clarinet score: reads a tone above what it sounds. */
  function clarinetStore() {
    const store = createAppStore({ context: testStoreContext() });
    const base = twinkleScore();
    store.getState().setScore({
      ...base,
      tracks: base.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    });
    return store;
  }

  it('defaults to concert pitch, changing nothing', () => {
    const store = clarinetStore();
    expect(store.getState().pitchDisplay).toBe('concert');
    render(<ScoreEditorView store={store} />);
    expect(store.getState().score!.tracks[0].measures[0].keySignature.fifths).toBe(0);
  });

  it('never writes the transposed score back to the store', () => {
    // The guard that matters: the lens must not become the model.
    const store = clarinetStore();
    const before = JSON.stringify(store.getState().score);
    act(() => store.getState().setPitchDisplay('written'));
    render(<ScoreEditorView store={store} />);
    expect(JSON.stringify(store.getState().score)).toBe(before);
  });

  it('keeps the selection across a toggle', () => {
    // Ids survive the transformation, so nothing has to be remapped.
    const store = clarinetStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    act(() => store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] }));
    render(<ScoreEditorView store={store} />);

    act(() => store.getState().setPitchDisplay('written'));
    expect(store.getState().selection.eventIds).toEqual([noteId]);
  });

  it('draws the written key signature, two sharps for a clarinet in concert C', () => {
    // Canvas ink cannot be read directly, so assert the score the renderer is
    // handed: this is the whole observable point of the feature.
    const store = clarinetStore();
    expect(store.getState().score!.tracks[0].measures[0].keySignature.fifths).toBe(0);
    expect(writtenScore(store.getState().score!).tracks[0].measures[0].keySignature.fifths).toBe(2);
  });

  it('transposes a pitch-drag preview with the rest of the staff', () => {
    // The ordering bug: the drag preview splices in a *sounding* pitch, so the
    // written transform has to run after it. Applying the lens first would draw
    // the dragged note an instrument's transposition below its own staff.
    const store = clarinetStore();
    const note = allNotes(store.getState().score!)[0];
    const dragged = scoreWithPitch(store.getState().score!, note.id, shiftDiatonic(note.pitch, 1));
    const shown = writtenScore(dragged);
    const shownNote = allNotes(shown).find((n) => n.id === note.id)!;
    const shownNeighbour = allNotes(shown).find((n) => n.id !== note.id)!;
    const soundingNeighbour = allNotes(store.getState().score!).find((n) => n.id !== note.id)!;

    // Every note on the staff moved by the same transposition, dragged or not.
    expect(pitchToMidi(shownNeighbour.pitch) - pitchToMidi(soundingNeighbour.pitch)).toBe(2);
    expect(pitchToMidi(shownNote.pitch) - pitchToMidi(shiftDiatonic(note.pitch, 1))).toBe(2);
  });
});

describe('ScoreEditorView: following playback never cancels its own smooth scroll', () => {
  it('issues no scrollTo for a measure that needs no move', async () => {
    // The bug: every measure produced a scrollTo, even one naming the position
    // the box was already at. `behavior: 'smooth'` means such a call aborts the
    // animation still running from the previous measure and strands it partway,
    // so the sheet crept a little and then stopped following the music.
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(stressScore(1, 40));
    const { getByTestId } = render(<ScoreEditorView store={store} />);

    const box = getByTestId('score-editor-scroll');
    Object.defineProperty(box, 'clientHeight', { value: 5000, configurable: true }); // whole score visible
    Object.defineProperty(box, 'clientWidth', { value: 1200, configurable: true });
    Object.defineProperty(box, 'scrollTop', { value: 0, configurable: true, writable: true });
    Object.defineProperty(box, 'scrollLeft', { value: 0, configurable: true, writable: true });
    const scrollTo = vi.fn();
    Object.defineProperty(box, 'scrollTo', { value: scrollTo, configurable: true, writable: true });
    // The canvas learns the view's size and scroll from the scroll box's own
    // events, as it does in a browser; jsdom has no layout to fire one.
    fireEvent.scroll(box);

    await act(async () => setTransport(store, 'playing'));
    const measures = store.getState().score!.tracks[0].measures;
    for (let i = 0; i < 10; i++) {
      await act(async () => seekTo(measures[i].startTick + 1));
    }

    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('generating a track', () => {
  it('submits a job and closes, instead of holding the modal until it finishes', async () => {
    // Generating a track takes as long as any other generation. The modal used
    // to wait it out: you could not look at another project, and navigating
    // away lost the work. Replace Notes/Measures/Track already went through the
    // server-side runner for exactly this reason.
    const store = makeStore();
    const onGenerateTrackJob = vi.fn().mockResolvedValue(undefined);
    render(<ScoreEditorView store={store} onGenerateTrackJob={onGenerateTrackJob} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Add Track'));
    await user.click(await screen.findByRole('option', { name: 'Generate Track' }));
    await user.type(screen.getByLabelText('Prompt'), 'a walking bass line');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    expect(onGenerateTrackJob).toHaveBeenCalledTimes(1);
    const request = onGenerateTrackJob.mock.calls[0][0];
    // Matched to the open score, or the new track will not line up with it.
    expect(request.prompt).toBe('a walking bass line');
    expect(request.durationMeasures).toBe(store.getState().score!.tracks[0].measures.length);
    expect(request.tracks).toHaveLength(1);
    // And the dialog is gone: what happens next is the overlay.
    await waitFor(() => expect(screen.queryByLabelText('Prompt')).toBeNull());
  });

  it('leaves the score alone — the server applies the result, not the client', async () => {
    // The job runner appends the track with `appendTrackCommand` and the
    // editor reloads the project. A client-side splice here would race it.
    const store = makeStore();
    const before = store.getState().score;
    render(
      <ScoreEditorView store={store} onGenerateTrackJob={vi.fn().mockResolvedValue(undefined)} />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Add Track'));
    await user.click(await screen.findByRole('option', { name: 'Generate Track' }));
    await user.type(screen.getByLabelText('Prompt'), 'strings');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    expect(store.getState().score).toBe(before);
  });
});

describe('ScoreEditorView: selecting a span of bars', () => {
  it('selects one bar on a plain gutter click', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;

    fireEvent.click(interactionSurface(), gutterPoint(score, 2));

    expect(store.getState().selection.measureIds).toEqual([score.tracks[0].measures[2].id]);
  });

  it('extends to a range on shift-click, so a span is two clicks not ten', () => {
    // Regeneration and Replace Measures both work on a span, and picking one
    // out a bar at a time was the slowest part of using them.
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;

    fireEvent.click(interactionSurface(), gutterPoint(score, 1));
    fireEvent.click(interactionSurface(), { ...gutterPoint(score, 5), shiftKey: true });

    const expected = score.tracks[0].measures.slice(1, 6).map((m) => m.id);
    expect(store.getState().selection.measureIds).toEqual(expected);
  });

  it('extends backwards from the anchor just as well', () => {
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;

    fireEvent.click(interactionSurface(), gutterPoint(score, 5));
    fireEvent.click(interactionSurface(), { ...gutterPoint(score, 2), shiftKey: true });

    const expected = score.tracks[0].measures.slice(2, 6).map((m) => m.id);
    expect(store.getState().selection.measureIds).toEqual(expected);
  });

  it('grows and shrinks from one anchor rather than walking it', () => {
    // Extending twice from the same anchor is how every list behaves.
    const store = makeStore();
    render(<ScoreEditorView store={store} />);
    const score = store.getState().score!;

    fireEvent.click(interactionSurface(), gutterPoint(score, 1));
    fireEvent.click(interactionSurface(), { ...gutterPoint(score, 5), shiftKey: true });
    fireEvent.click(interactionSurface(), { ...gutterPoint(score, 3), shiftKey: true });

    expect(store.getState().selection.measureIds).toEqual(
      score.tracks[0].measures.slice(1, 4).map((m) => m.id),
    );
  });
});
