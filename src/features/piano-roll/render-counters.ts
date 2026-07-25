/**
 * Test-only render instrumentation for `PianoRollView` (not read by any
 * production code): `PianoRollView.test.tsx` uses this to assert that a
 * `positionTick` update re-renders only the isolated `PlaybackCursor`
 * subcomponent, not `NoteLayer` — the fix for the "playback cursor not
 * isolated" review finding. Kept in its own module (rather than exported
 * alongside `NoteLayer` in `PianoRollView.tsx`) purely so that `.tsx` file
 * only exports components, per `react-refresh/only-export-components`.
 *
 * Compared as a *delta* (before/after a `positionTick` change) by tests,
 * so `noteLayerRenderCount` deliberately isn't reset between tests.
 */
let noteLayerRenderCount = 0;

/** Called once per `NoteLayer` render (see `PianoRollView.tsx`). */
export function recordNoteLayerRender(): void {
  noteLayerRenderCount += 1;
}

export function __getNoteLayerRenderCountForTests(): number {
  return noteLayerRenderCount;
}
