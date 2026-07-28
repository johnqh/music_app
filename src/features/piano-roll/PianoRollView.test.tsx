import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { useLayoutEffect } from 'react';
import { act, render, fireEvent } from '@testing-library/react';
import { createAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { pitchToMidi, stressScore, twinkleScore, twoTrackScore } from '@sudobility/music_lib';
import { allNotes, findEvent } from '@sudobility/music_lib';
import type { NoteEvent } from '@sudobility/music_types';
import { extractFragment } from '@sudobility/music_lib';
import {
  VELOCITY_LANE_HEIGHT,
  computeNoteRects,
  keyboardHeightPx,
  midiToY,
  tickToX,
  trackWidthPx,
  voiceLaneStripHeight,
} from '@/features/piano-roll/geometry';
import { PianoRollView } from '@/features/piano-roll/PianoRollView';
import { __getNoteLayerRenderCountForTests } from '@/features/piano-roll/render-counters';

function makeStore(): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twinkleScore());
  return store;
}

afterEach(async () => {});

function noteRect(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="pr-note-${id}"]`);
  if (!el) throw new Error(`No rendered rect for note ${id}`);
  return el;
}

/**
 * Test-only helper (Task 17 review finding 1) that captures a DOM
 * snapshot at the very first commit of whatever it's rendered alongside,
 * via its own `useLayoutEffect` with an empty dependency array (so it
 * fires exactly once, as part of the first commit's layout-effect phase —
 * before any state update *that same first commit's* own layout effects
 * may have queued has been applied). Rendered as a sibling (order doesn't
 * matter: React finishes applying every DOM mutation for a commit before
 * running *any* component's layout effects, and only processes queued
 * updates after that whole batch completes), so this observes the raw,
 * pre-correction DOM — not the settled state `render()` normally hands
 * back once every effect (including any corrective ones) has flushed.
 * Reads from `document.body` rather than RTL's own `container` return
 * value, since this callback fires synchronously *during* `render()`,
 * before that value even exists.
 */
function FirstCommitProbe({ onFirstCommit }: { onFirstCommit: () => void }) {
  useLayoutEffect(() => {
    onFirstCommit();
    // Deliberately empty deps: capture the very first commit only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe('PianoRollView', () => {
  it('renders without a score loaded (empty state)', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(() => render(<PianoRollView store={store} />)).not.toThrow();
  });

  it('renders one rect per fixture note', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const notes = allNotes(store.getState().score!);
    for (const note of notes) {
      expect(container.querySelector(`[data-testid="pr-note-${note.id}"]`)).not.toBeNull();
    }
  });

  it('clicking a note selects it, and shift-clicking a second note adds it', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const [first, second] = allNotes(store.getState().score!) as NoteEvent[];
    const ppq = store.getState().score!.ppq;

    // Hit-testing here is coordinate-based (geometry.ts), not DOM-id-based
    // like ScoreEditorView's VexFlow click handler, so the fired
    // clientX/clientY must land on each note's own computed rect — not
    // just target its DOM element (which jsdom's zeroed
    // getBoundingClientRect() would make indistinguishable anyway).
    const firstX = tickToX(first.startTick, ppq, 1) + 5;
    const secondX = tickToX(second.startTick, ppq, 1) + 5;
    const y = midiToY(60, 1) + 7; // both notes are C4 in this fixture measure

    fireEvent.pointerDown(noteRect(container, first.id), {
      clientX: firstX,
      clientY: y,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(noteRect(container, first.id), {
      clientX: firstX,
      clientY: y,
      pointerId: 1,
    });
    expect(store.getState().selection.eventIds).toEqual([first.id]);

    fireEvent.pointerDown(noteRect(container, second.id), {
      clientX: secondX,
      clientY: y,
      button: 0,
      pointerId: 2,
      shiftKey: true,
    });
    fireEvent.pointerUp(noteRect(container, second.id), {
      clientX: secondX,
      clientY: y,
      pointerId: 2,
      shiftKey: true,
    });
    expect(store.getState().selection.eventIds).toEqual([first.id, second.id]);
  });

  it('double-clicking an empty cell adds a note via addNoteCommand', () => {
    const store = makeStore();
    const { getByTestId } = render(<PianoRollView store={store} />);
    const before = allNotes(store.getState().score!).length;
    const grid = getByTestId('piano-roll-grid');

    // tick ~200 (raw; addNoteAtCell snaps internally), midi 84 (C6) — well
    // above the fixture's own octave-4 melody, so this cell is guaranteed
    // empty.
    const x = tickToX(200, store.getState().score!.ppq, 1);
    const y = midiToY(84, 1);
    fireEvent.doubleClick(grid, { clientX: x, clientY: y, button: 0 });

    const after = allNotes(store.getState().score!);
    expect(after.length).toBe(before + 1);
    expect(store.getState().canUndo).toBe(true);
  });

  it('double-clicking directly on an existing note is a no-op (does not add a duplicate)', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!);
    const before = store.getState().score;

    fireEvent.doubleClick(noteRect(container, first.id), { clientX: 5, clientY: 679, button: 0 });

    expect(store.getState().score).toBe(before);
  });

  it('dragging a note horizontally and vertically dispatches a single moveNotesCommand on pointer-up', () => {
    const store = makeStore();
    const { container, getByTestId } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!) as NoteEvent[];
    const grid = getByTestId('piano-roll-grid');

    // note[0]: startTick 0, C4 (midi 60), quarter (480 ticks @ ppq 480) ->
    // rect x=0 y=672 w=60 h=14 (see geometry.ts's tickToX/midiToY math).
    fireEvent.pointerDown(noteRect(container, first.id), {
      clientX: 5,
      clientY: 679,
      button: 0,
      pointerId: 3,
    });
    fireEvent.pointerMove(grid, { clientX: 65, clientY: 665, pointerId: 3 });
    fireEvent.pointerUp(grid, { clientX: 65, clientY: 665, pointerId: 3 });

    const updated = findEvent(store.getState().score!, first.id) as NoteEvent;
    // +480 ticks (one quarter note, snapped to the default quarter grid)
    // and +1 semitone (one row up: C4 -> C#4, sharp-spelled in C major).
    expect(updated.startTick).toBe(480);
    expect(updated.pitch).toEqual({ step: 'C', accidental: 1, octave: 4 });
    expect(store.getState().canUndo).toBe(true);
  });

  it('a plain pointerdown/up on a note with no movement only selects it (no move command)', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!) as NoteEvent[];
    const before = store.getState().score;

    fireEvent.pointerDown(noteRect(container, first.id), {
      clientX: 5,
      clientY: 679,
      button: 0,
      pointerId: 4,
    });
    fireEvent.pointerUp(noteRect(container, first.id), { clientX: 5, clientY: 679, pointerId: 4 });

    expect(store.getState().score).toBe(before);
    expect(store.getState().selection.eventIds).toEqual([first.id]);
  });

  it('dragging the right edge of a note resizes it via resizeNotesCommand', () => {
    const store = makeStore();
    store.getState().setSnapGrid('eighth'); // 240 ticks @ ppq 480: an exact, achievable shrink target
    const { container, getByTestId } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!);
    const grid = getByTestId('piano-roll-grid');

    // Right edge of note[0]'s rect is at x=60. Drag it to x=30 (-30px =
    // -240 ticks) to shrink from 480 to 240 ticks — a pure shrink, so no
    // overlap-with-neighbor ambiguity.
    fireEvent.pointerDown(noteRect(container, first.id), {
      clientX: 60,
      clientY: 679,
      button: 0,
      pointerId: 6,
    });
    fireEvent.pointerMove(grid, { clientX: 30, clientY: 679, pointerId: 6 });
    fireEvent.pointerUp(grid, { clientX: 30, clientY: 679, pointerId: 6 });

    const updated = findEvent(store.getState().score!, first.id);
    expect(updated?.durationTicks).toBe(240);
  });

  it('dragging a note into the voice-lane strip dispatches changeVoiceCommand instead of a move', () => {
    const store = makeStore();
    const { container, getByTestId } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!);
    const grid = getByTestId('piano-roll-grid');
    const voiceLaneTop = keyboardHeightPx(1); // top of the voice-lane strip at zoomV=1
    // Row height is 20px (VOICE_LANE_ROW_HEIGHT); targeting +25px lands in
    // lane index 1 — the note already starts in voice 0, so targeting lane
    // 0 would be an observably-inert no-op.
    const targetY = voiceLaneTop + 25;

    fireEvent.pointerDown(noteRect(container, first.id), {
      clientX: 5,
      clientY: 679,
      button: 0,
      pointerId: 7,
    });
    fireEvent.pointerMove(grid, { clientX: 5, clientY: targetY, pointerId: 7 });
    fireEvent.pointerUp(grid, { clientX: 5, clientY: targetY, pointerId: 7 });

    const score = store.getState().score!;
    const track = score.tracks[0];
    const measure = track.measures.find((m) =>
      m.voices.some((v) => v.events.some((e) => e.id === first.id)),
    )!;
    expect(measure.voices[0]?.events.some((e) => e.id === first.id)).toBe(false);
    expect(measure.voices[1]?.events.some((e) => e.id === first.id)).toBe(true);
  });

  it('dragging a note velocity-lane bar dispatches changeVelocityCommand', () => {
    const store = makeStore();
    const { getByTestId } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!) as NoteEvent[];
    const bar = getByTestId(`pr-velocity-${first.id}`);
    const voiceLaneTop = keyboardHeightPx(1);
    const velocityTop = voiceLaneTop + voiceLaneStripHeight(2); // twinkleScore has 1 voice/measure -> floor of 2 lanes

    const relativeY = 10; // near the top of the lane -> a high velocity
    fireEvent.pointerDown(bar, {
      clientX: 0,
      clientY: velocityTop + relativeY,
      button: 0,
      pointerId: 8,
    });
    fireEvent.pointerUp(bar, { clientX: 0, clientY: velocityTop + relativeY, pointerId: 8 });

    const expectedVelocity = Math.round(
      ((VELOCITY_LANE_HEIGHT - relativeY) / VELOCITY_LANE_HEIGHT) * 127,
    );
    const updated = findEvent(store.getState().score!, first.id) as NoteEvent;
    expect(updated.velocity).toBe(expectedVelocity);
  });

  it('renders preview-fragment notes distinctly from committed notes', () => {
    const store = makeStore();
    const score = store.getState().score!;
    const track = score.tracks[0];
    const range = { startTick: 0, endTick: track.measures[0].durationTicks, trackIds: [track.id] };
    const fragment = extractFragment(score, range);
    store.setState((state) => {
      state.previewFragment = fragment;
    });

    const { container } = render(<PianoRollView store={store} />);
    const firstFragmentNote = track.measures[0].voices[0].events[0];

    expect(
      container.querySelector(`[data-testid="pr-preview-${firstFragmentNote.id}"]`),
    ).not.toBeNull();
  });

  it('renders a playback cursor line positioned from positionTick', () => {
    const store = makeStore();
    store.getState().setPositionTick(480);
    const { getByTestId } = render(<PianoRollView store={store} />);
    const cursor = getByTestId('piano-roll-cursor');
    expect(cursor.style.left).toBe(`${tickToX(480, store.getState().score!.ppq, 1)}px`);
  });

  it('renders loop-region shading when a loop range is set', () => {
    const store = makeStore();
    const score = store.getState().score!;
    store.getState().setLoopRange({ startTick: 0, endTick: 1920, trackIds: [score.tracks[0].id] });
    const { getByTestId } = render(<PianoRollView store={store} />);
    expect(getByTestId('piano-roll-loop-region')).toBeInTheDocument();
  });

  it('renders the keyboard column with octave-labeled C rows', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    expect(container.querySelector('[data-testid="piano-roll-keyboard"]')).not.toBeNull();
    expect(container.textContent).toContain('C4');
  });

  describe('pointercancel handling', () => {
    it('a pointercancel mid note-drag resets state without dispatching a command, and the next drag starts fresh', () => {
      const store = makeStore();
      const { container, getByTestId, queryByTestId } = render(<PianoRollView store={store} />);
      const [first] = allNotes(store.getState().score!) as NoteEvent[];
      const grid = getByTestId('piano-roll-grid');
      const before = store.getState().score;

      fireEvent.pointerDown(noteRect(container, first.id), {
        clientX: 5,
        clientY: 679,
        button: 0,
        pointerId: 20,
      });
      fireEvent.pointerMove(grid, { clientX: 65, clientY: 665, pointerId: 20 });
      fireEvent.pointerCancel(grid, { pointerId: 20 });

      expect(store.getState().score).toBe(before);
      expect(queryByTestId('piano-roll-drag-box')).toBeNull();

      // The cancel must not leave any stale drag state behind: a fresh
      // plain click now behaves like an ordinary (non-dragging) click.
      fireEvent.pointerDown(noteRect(container, first.id), {
        clientX: 5,
        clientY: 679,
        button: 0,
        pointerId: 21,
      });
      fireEvent.pointerUp(noteRect(container, first.id), {
        clientX: 5,
        clientY: 679,
        pointerId: 21,
      });
      expect(store.getState().selection.eventIds).toEqual([first.id]);
      expect(store.getState().score).toBe(before);
    });

    it('a pointercancel mid box-select resets the overlay without changing the selection', () => {
      const store = makeStore();
      const { getByTestId, queryByTestId } = render(<PianoRollView store={store} />);
      const grid = getByTestId('piano-roll-grid');
      const before = store.getState().selection;

      fireEvent.pointerDown(grid, { clientX: 500, clientY: 500, button: 0, pointerId: 22 });
      fireEvent.pointerMove(grid, { clientX: 600, clientY: 600, pointerId: 22 });
      expect(getByTestId('piano-roll-drag-box')).toBeInTheDocument();

      fireEvent.pointerCancel(grid, { pointerId: 22 });

      expect(queryByTestId('piano-roll-drag-box')).toBeNull();
      expect(store.getState().selection).toEqual(before);
    });

    it('a pointercancel on a velocity-lane bar does not commit a velocity change', () => {
      const store = makeStore();
      const { getByTestId } = render(<PianoRollView store={store} />);
      const [first] = allNotes(store.getState().score!) as NoteEvent[];
      const bar = getByTestId(`pr-velocity-${first.id}`);
      const before = store.getState().score;

      fireEvent.pointerDown(bar, { clientX: 0, clientY: 700, button: 0, pointerId: 23 });
      fireEvent.pointerCancel(bar, { pointerId: 23 });

      expect(store.getState().score).toBe(before);
    });
  });

  describe('playback-cursor isolation', () => {
    it('positionTick updates re-render only the cursor, not the note layer', () => {
      const store = makeStore();
      const { getByTestId } = render(<PianoRollView store={store} />);
      const renderCountBefore = __getNoteLayerRenderCountForTests();

      act(() => store.getState().setPositionTick(480));
      act(() => store.getState().setPositionTick(960));

      // The note layer's own render count is unchanged...
      expect(__getNoteLayerRenderCountForTests()).toBe(renderCountBefore);
      // ...while the cursor itself genuinely did move, proving this isn't
      // just "nothing re-rendered at all".
      const cursor = getByTestId('piano-roll-cursor');
      expect(cursor.style.left).toBe(`${tickToX(960, store.getState().score!.ppq, 1)}px`);
    });
  });

  describe('virtualization (spec §29): culls notes outside the scroll viewport', () => {
    // jsdom never lays anything out (`clientWidth`/`clientHeight` are
    // always 0), which PianoRollView treats as "viewport not measurable
    // yet" and renders every note (see `measureViewport`'s doc comment) —
    // exactly what every other test in this file relies on. These tests
    // stub the scroll geometry directly so a real (non-zero) measurement
    // flows through `cullToViewport`.
    function mockScrollGeometry(
      scrollBox: HTMLElement,
      clientWidth: number,
      clientHeight: number,
      scrollLeft: number,
      scrollTop: number,
    ): void {
      Object.defineProperty(scrollBox, 'clientWidth', { value: clientWidth, configurable: true });
      Object.defineProperty(scrollBox, 'clientHeight', { value: clientHeight, configurable: true });
      Object.defineProperty(scrollBox, 'scrollLeft', {
        value: scrollLeft,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(scrollBox, 'scrollTop', {
        value: scrollTop,
        configurable: true,
        writable: true,
      });
    }

    // `handleScroll` throttles `measureViewport` via `requestAnimationFrame`
    // (Task 17 review finding), so `fireEvent.scroll` alone wouldn't
    // synchronously apply a new measurement in these tests. Stubbing rAF to
    // invoke its callback immediately keeps the tests synchronous while
    // still exercising the real scroll -> measure -> cull code path (only
    // the "wait for the next frame" part is short-circuited).
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

    function makeBigStore(): EditorStoreApi {
      const store = createAppStore({ context: testStoreContext() });
      store.getState().setScore(stressScore(1, 100)); // wide enough (100 measures) for real horizontal scroll range
      return store;
    }

    function noteTestIds(container: HTMLElement): number {
      return container.querySelectorAll('[data-testid^="pr-note-"]').length;
    }

    it('renders every note once settled when the viewport is genuinely unmeasurable (jsdom fallback)', () => {
      const store = makeBigStore();
      const { container } = render(<PianoRollView store={store} />);
      // jsdom's `clientHeight` is always 0, so `measureViewport` (run by
      // the mount `useLayoutEffect`, already flushed by the time `render()`
      // returns) records the `'unmeasurable'` sentinel, which falls back
      // to rendering every note - exactly the pre-fix behavior, so this
      // environment (and any other that can never produce a real
      // measurement) keeps working.
      expect(noteTestIds(container)).toBe(allNotes(store.getState().score!).length);
    });

    it('renders only notes near the left of a narrow viewport, and flips to the right on scroll (velocity-lane bars are never culled)', () => {
      const store = makeBigStore();
      const score = store.getState().score!;
      const notes = allNotes(score);
      const firstNoteId = notes[0].id;
      const lastNoteId = notes[notes.length - 1].id;
      const totalWidth = trackWidthPx(score.tracks[0], score.ppq, 1);

      const { container, getByTestId } = render(<PianoRollView store={store} />);
      const scrollBox = getByTestId('piano-roll-scroll');

      mockScrollGeometry(scrollBox, 400, 2000, 0, 0); // tall clientHeight: isolates the test to horizontal culling only
      fireEvent.scroll(scrollBox);

      expect(container.querySelector(`[data-testid="pr-note-${firstNoteId}"]`)).not.toBeNull();
      expect(container.querySelector(`[data-testid="pr-note-${lastNoteId}"]`)).toBeNull();
      expect(noteTestIds(container)).toBeLessThan(notes.length);
      // Velocity-lane bars are a different vertical lane than the note
      // grid, so they're deliberately never culled (see PianoRollView.tsx's
      // doc comment) — every note still has one.
      expect(container.querySelectorAll('[data-testid^="pr-velocity-"]').length).toBe(notes.length);

      mockScrollGeometry(scrollBox, 400, 2000, Math.max(0, totalWidth - 400), 0);
      fireEvent.scroll(scrollBox);

      expect(container.querySelector(`[data-testid="pr-note-${lastNoteId}"]`)).not.toBeNull();
      expect(container.querySelector(`[data-testid="pr-note-${firstNoteId}"]`)).toBeNull();
    });

    it('renders an EMPTY note layer on the true first commit, not every note (Task 17 review finding 1: the first commit must not mount-then-discard every note)', () => {
      const store = makeBigStore();

      // Patches `clientWidth`/`clientHeight` on every element (prototype
      // getters, not per-node) *before* mount, simulating a real browser's
      // first layout pass rather than jsdom's always-zero one - so
      // `useLayoutEffect`'s corrective measurement has a real, nonzero
      // value to work with the moment it runs.
      const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
      const heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);

      let firstCommitNoteCount: number | null = null;
      render(
        <>
          <FirstCommitProbe
            onFirstCommit={() => {
              firstCommitNoteCount = document.body.querySelectorAll(
                '[data-testid^="pr-note-"]',
              ).length;
            }}
          />
          <PianoRollView store={store} />
        </>,
      );

      // The very first commit - before PianoRollView's own mount
      // useLayoutEffect has had a chance to apply its correction - already
      // rendered an empty note layer, not every note. This is the actual
      // fix: previously this was the *total* note count (thousands of
      // `Box` elements mounted, then immediately discarded on the very
      // next commit).
      expect(firstCommitNoteCount).toBe(0);

      widthSpy.mockRestore();
      heightSpy.mockRestore();
    });

    it('culls notes already by the time mount settles when the viewport is measurable (no lingering full-then-corrected render)', () => {
      const store = makeBigStore();
      const totalNotes = allNotes(store.getState().score!).length;

      const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
      const heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);

      const { container } = render(<PianoRollView store={store} />);

      expect(noteTestIds(container)).toBeLessThan(totalNotes);
      expect(noteTestIds(container)).toBeGreaterThan(0);

      widthSpy.mockRestore();
      heightSpy.mockRestore();
    });

    it('renders an EMPTY note layer on the true first commit even when the viewport turns out to be unmeasurable (jsdom)', () => {
      const store = makeBigStore();

      let firstCommitNoteCount: number | null = null;
      render(
        <>
          <FirstCommitProbe
            onFirstCommit={() => {
              firstCommitNoteCount = document.body.querySelectorAll(
                '[data-testid^="pr-note-"]',
              ).length;
            }}
          />
          <PianoRollView store={store} />
        </>,
      );

      // Still empty on the true first commit - `visibleNoteIds` starts
      // `undefined` regardless of whether the mount effect will go on to
      // resolve it to a real culled set or the `'unmeasurable'` fallback;
      // only the *settled* state (after that effect runs) differs between
      // the two cases.
      expect(firstCommitNoteCount).toBe(0);
    });

    it('does not re-render the note layer for repeated scroll positions within the same visible window, but does when scrolling reveals different notes', () => {
      const store = makeBigStore();
      const { getByTestId } = render(<PianoRollView store={store} />);
      const scrollBox = getByTestId('piano-roll-scroll');

      // Establishing the first *real* (non-jsdom-default) measurement is
      // expected to trigger exactly one NoteLayer re-render, since it
      // necessarily differs from the pre-measurement "every note visible"
      // state.
      mockScrollGeometry(scrollBox, 400, 2000, 0, 0);
      fireEvent.scroll(scrollBox);
      const countAfterFirstScroll = __getNoteLayerRenderCountForTests();

      // Two more tiny scrolls, nowhere near the overscan boundary - neither
      // should change which notes are visible, so neither should re-render
      // NoteLayer.
      mockScrollGeometry(scrollBox, 400, 2000, 5, 0);
      fireEvent.scroll(scrollBox);
      mockScrollGeometry(scrollBox, 400, 2000, 10, 0);
      fireEvent.scroll(scrollBox);
      expect(__getNoteLayerRenderCountForTests()).toBe(countAfterFirstScroll);

      // A large scroll, far past the overscan buffer, reveals a genuinely
      // different set of notes and must re-render.
      const score = store.getState().score!;
      const totalWidth = trackWidthPx(score.tracks[0], score.ppq, 1);
      mockScrollGeometry(scrollBox, 400, 2000, Math.max(0, totalWidth - 400), 0);
      fireEvent.scroll(scrollBox);
      expect(__getNoteLayerRenderCountForTests()).toBeGreaterThan(countAfterFirstScroll);
    });

    it('does not change which notes are interactable: a culled-from-the-DOM note can still be clicked and selected', () => {
      const store = makeBigStore();
      const score = store.getState().score!;
      const notes = allNotes(score);
      const lastNote = notes[notes.length - 1];
      const lastRect = computeNoteRects(score, { visibleTrackIds: null, zoomH: 1, zoomV: 1 }).find(
        (r) => r.id === lastNote.id,
      )!;

      const { container, getByTestId } = render(<PianoRollView store={store} />);
      const scrollBox = getByTestId('piano-roll-scroll');
      mockScrollGeometry(scrollBox, 400, 400, 0, 0); // scrolled to the left: the last note is culled from the DOM
      fireEvent.scroll(scrollBox);
      expect(container.querySelector(`[data-testid="pr-note-${lastNote.id}"]`)).toBeNull(); // confirms it's genuinely culled

      // jsdom's getBoundingClientRect() is all-zero, so clientX/clientY on
      // the grid container directly are the note's own grid-local
      // coordinates — the exact mechanism PianoRollView's `pointFromEvent`
      // relies on (see the other coordinate-based click tests above).
      const grid = getByTestId('piano-roll-grid');
      const x = lastRect.x + 1;
      const y = lastRect.y + 1;

      fireEvent.pointerDown(grid, { clientX: x, clientY: y, button: 0, pointerId: 99 });
      fireEvent.pointerUp(grid, { clientX: x, clientY: y, pointerId: 99 });

      expect(store.getState().selection.eventIds).toEqual([lastNote.id]);
    });
  });
});

describe('PianoRollView: active track only', () => {
  it('renders notes from the active track and no others', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twoTrackScore());
    const score = store.getState().score!;
    act(() => store.getState().setActiveTrack(score.tracks[1].id));

    const { container } = render(<PianoRollView store={store} />);

    const trackOne = allNotes(score).find((n) => n.trackId === score.tracks[1].id)!;
    const trackZero = allNotes(score).find((n) => n.trackId === score.tracks[0].id)!;
    expect(container.querySelector(`[data-testid="pr-note-${trackOne.id}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-testid="pr-note-${trackZero.id}"]`)).toBeNull();
  });

  it('defaults to the first track when none is explicitly active', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twoTrackScore());
    const score = store.getState().score!;

    const { container } = render(<PianoRollView store={store} />);

    const trackZero = allNotes(score).find((n) => n.trackId === score.tracks[0].id)!;
    expect(container.querySelector(`[data-testid="pr-note-${trackZero.id}"]`)).not.toBeNull();
  });

  it('follows the active track when it changes', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twoTrackScore());
    const score = store.getState().score!;
    act(() => store.getState().setActiveTrack(score.tracks[0].id));
    const { container } = render(<PianoRollView store={store} />);
    const trackZero = allNotes(score).find((n) => n.trackId === score.tracks[0].id)!;
    expect(container.querySelector(`[data-testid="pr-note-${trackZero.id}"]`)).not.toBeNull();

    act(() => store.getState().setActiveTrack(score.tracks[1].id));

    expect(container.querySelector(`[data-testid="pr-note-${trackZero.id}"]`)).toBeNull();
  });
});

describe('PianoRollView: note state colors', () => {
  it('colors an unselected note with the normal color', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const note = allNotes(store.getState().score!)[0];
    expect(noteRect(container, note.id).style.backgroundColor).toBe('rgb(63, 63, 70)');
  });

  it('colors a selected note black', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const note = allNotes(store.getState().score!)[0];

    act(() => {
      store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    });

    expect(noteRect(container, note.id).style.backgroundColor).toBe('rgb(0, 0, 0)');
  });

  it('colors a regenerated selection brown', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const note = allNotes(store.getState().score!)[0];

    act(() => {
      store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
      store.setState({ selectionRegenerated: true });
    });

    expect(noteRect(container, note.id).style.backgroundColor).toBe('rgb(139, 90, 43)');
  });

  it('colors a sounding note blue', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const note = allNotes(store.getState().score!)[0];

    act(() => store.getState().setActiveNoteIds([note.id]));

    expect(noteRect(container, note.id).style.backgroundColor).toBe('rgb(21, 101, 192)');
  });
});

describe('PianoRollView: playback key highlighting', () => {
  function key(container: HTMLElement, midi: number): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-testid="pr-key-${midi}"]`);
    if (!el) throw new Error(`no keyboard row for midi ${midi}`);
    return el;
  }

  it('highlights the key of a sounding note on the active track', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const note = allNotes(store.getState().score!)[0];

    act(() => store.getState().setActiveNoteIds([note.id]));

    expect(key(container, pitchToMidi(note.pitch)).dataset.playing).toBe('true');
  });

  it('clears the highlight when the note stops', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const note = allNotes(store.getState().score!)[0];
    act(() => store.getState().setActiveNoteIds([note.id]));

    act(() => store.getState().setActiveNoteIds([]));

    expect(key(container, pitchToMidi(note.pitch)).dataset.playing).toBe('false');
  });

  it('does not highlight keys for notes sounding on another track', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twoTrackScore());
    const score = store.getState().score!;
    act(() => store.getState().setActiveTrack(score.tracks[0].id));
    const { container } = render(<PianoRollView store={store} />);
    const other = allNotes(score).find((n) => n.trackId === score.tracks[1].id)!;

    act(() => store.getState().setActiveNoteIds([other.id]));

    expect(key(container, pitchToMidi(other.pitch)).dataset.playing).toBe('false');
  });
});

describe('PianoRollView: collapse', () => {
  it('renders only the toolbar when collapsed', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} collapsed />);
    expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="piano-roll-grid"]')).toBeNull();
  });

  it('renders the grid when expanded', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    expect(container.querySelector('[data-testid="piano-roll-grid"]')).not.toBeNull();
  });
});
