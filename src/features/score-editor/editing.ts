/**
 * UI-intent -> store-command mapping for the score editor (spec §7's
 * editing-operations list, minus copy/cut/paste/undo/redo, which are
 * already first-class store actions — see `useEditorShortcuts.ts`, which
 * calls those directly and calls into this module for everything else).
 *
 * Every function here takes the store's *bound API* (`EditorStoreApi` —
 * the same shape `createAppStore()`/`useAppStore` return: a React hook
 * that is also a vanilla `getState()`/`subscribe()` object), not a
 * snapshot, and reads fresh state via `store.getState()` on every call —
 * safe to call repeatedly from an event handler without stale-closure
 * risk, and directly unit-testable against a real store instance (no
 * React rendering required).
 *
 * Every mutating function funnels through `dispatchTracked`, which
 * compares `validationIssues` before/after the command and pushes an
 * error toast (spec §7 "prevent edits that create invalid measures...
 * show validation errors clearly") when the edit introduces a *new*
 * validation error that wasn't already present. Existing pre-edit errors
 * are not re-announced on every subsequent unrelated edit.
 */
import type { createAppStore } from '@sudobility/music_lib';
import type {
  Accidental,
  Articulation,
  DurationName,
  NoteEvent,
  Pitch,
  Score,
  UUID,
} from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import type { MusicalEvent } from '@sudobility/music_types';
import type { ScoreSelection } from '@sudobility/music_lib';
import type { ScoreCommand } from '@sudobility/music_lib';
import type { ValidationIssue } from '@sudobility/music_lib';
import {
  allNotes,
  findEvent,
  findTrack,
  playbackController,
  selectActiveTrackId,
} from '@sudobility/music_lib';
import { gmMaxPolyphony, insertWithRippleCommand, trackMaxPolyphony } from '@sudobility/music_lib';
import type { EditMode } from '@sudobility/music_lib';
import { ticksFor } from '@sudobility/music_lib';
import {
  addNoteCommand,
  changeAccidentalCommand,
  changeArticulationCommand,
  changeDurationCommand,
  changeVelocityCommand,
  deleteEventsCommand,
  toggleTieCommand,
} from '@sudobility/music_lib';
import { addMeasureCommand, deleteMeasureCommand } from '@sudobility/music_lib';
import {
  applyQuantizedCommand,
  collectQuantizeTargets,
  pasteEventsCommand,
  quantizeCommand,
  transposeCommand,
} from '@sudobility/music_lib';
import type { QuantizeOptions } from '@sudobility/music_lib';
import { getQuantizeService } from '@sudobility/music_lib';
import type { QuantizeService } from '@sudobility/music_lib';

/** The store shape every function in this module operates on: same type `useAppStore`/`createAppStore()` produce. */
export type EditorStoreApi = ReturnType<typeof createAppStore>;

// ---- shared helpers ---------------------------------------------------------

function issueKey(issue: ValidationIssue): string {
  return `${issue.code}:${issue.objectId ?? ''}:${issue.measureId ?? ''}`;
}

/**
 * Runs `command` through the store's `dispatchCommand`, then pushes an
 * error toast if it introduced a validation error that wasn't already
 * present beforehand (identified by code+objectId+measureId). Every
 * mutating action in this module goes through this, not
 * `store.getState().dispatchCommand` directly.
 */
export function dispatchTracked(store: EditorStoreApi, command: ScoreCommand): void {
  const before = store.getState().validationIssues;
  store.getState().dispatchCommand(command);
  const after = store.getState().validationIssues;

  const beforeErrorKeys = new Set(before.filter((i) => i.severity === 'error').map(issueKey));
  const newError = after.find((i) => i.severity === 'error' && !beforeErrorKeys.has(issueKey(i)));
  if (newError) {
    store.getState().pushToast({
      message: `This edit produced a validation problem: ${newError.message}`,
      severity: 'error',
    });
  }
}

/** The subset of `selection.eventIds` that currently resolve to `NoteEvent`s in `score` (rests and stale ids are dropped). */
export function selectedNoteIds(score: Score, selection: ScoreSelection): UUID[] {
  return selection.eventIds.filter((id) => {
    const event = findEvent(score, id);
    return event !== null && isNoteEvent(event);
  });
}

// ---- insert note / rest ------------------------------------------------------

type InsertTarget = { trackId: UUID; measureId: UUID; voiceIndex: number; startTick: number };

/**
 * Resolves where an insert/rest action should target, from (in priority
 * order): the first selected event's own position; the first selected
 * measure's start; the first selected track's first measure; else the
 * score's very first measure. `null` only if the score has no measures at
 * all on any candidate track.
 */
export function resolveInsertTarget(
  score: Score,
  activeTrackId: UUID | null,
  caretTick: number,
  voiceIndex = 0,
): InsertTarget | null {
  // The caret, not the selection. Everywhere else in this editor the caret is
  // the anchor -- a click sets it, playback starts from it -- and inserting
  // from the selection meant that clicking empty staff (which moves the caret
  // and clears the selection) put the next note at the very start of the
  // score, nowhere near where the user was looking.
  const track = (activeTrackId ? findTrack(score, activeTrackId) : null) ?? score.tracks[0] ?? null;
  if (!track || track.measures.length === 0) return null;

  const tick = Math.max(0, caretTick);
  const measure =
    track.measures.find((m) => tick >= m.startTick && tick < m.startTick + m.durationTicks) ??
    // Past the end: the last measure, so a caret parked at the final barline
    // still inserts somewhere sensible rather than failing.
    track.measures[track.measures.length - 1];

  return {
    trackId: track.id,
    measureId: measure.id,
    voiceIndex,
    startTick: Math.min(tick, measure.startTick + measure.durationTicks - 1),
  };
}

/**
 * Inserts a note at the current selection's implied measure+beat (see
 * `resolveInsertTarget`), using the store's current `snapGrid` as the
 * note's duration. No-op if there's no score or no resolvable target.
 */
export function insertNoteAtCaret(
  store: EditorStoreApi,
  pitch: Pitch,
  options: { articulation?: Articulation; duration?: DurationName; advanceCaret?: boolean } = {},
): void {
  const state = store.getState();
  if (!state.score) return;
  const target = resolveInsertTarget(
    state.score,
    selectActiveTrackId(state),
    state.positionTick,
    state.activeVoiceIndex,
  );
  if (!target) return;

  const { articulation, duration, advanceCaret = false } = options;
  // `duration` overrides the toolbar grid, for callers that carry their own --
  // a key tap is written as long as it was held, not as long as the grid says.
  const durationTicks = ticksFor(duration ?? state.snapGrid, state.score.ppq);
  dispatchTracked(
    store,
    addNoteCommand({
      trackId: target.trackId,
      measureId: target.measureId,
      voiceIndex: target.voiceIndex,
      pitch,
      startTick: target.startTick,
      durationTicks,
      ...(articulation ? { articulation } : {}),
    }),
  );

  // Step the caret past what was just written, so a run of taps lays out a
  // melody instead of overwriting one position.
  if (advanceCaret) playbackController.seek(target.startTick + durationTicks);
}

/**
 * How many notes already sound at `tick` on `trackId`, counting only those
 * that start there — a chord is notes sharing a start, not notes overlapping.
 */
function chordSizeAt(score: Score, trackId: UUID, tick: number): number {
  const track = findTrack(score, trackId);
  if (!track) return 0;
  let count = 0;
  for (const measure of track.measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (isNoteEvent(event) && event.startTick === tick) count += 1;
      }
    }
  }
  return count;
}

/**
 * Writes `pitches` as one chord at the caret: one shared start tick and one
 * shared duration.
 *
 * The shared duration is the whole point, not a simplification. Notes at the
 * same tick cluster by `startTick:durationTicks`, so same-start notes whose
 * durations differ do not stack — the later one wins the span and the earlier
 * is dropped. Writing three keys with three separately-measured tap lengths
 * would therefore silently discard two of them.
 *
 * Refuses chords the instrument could not play (`trackMaxPolyphony`, which is
 * unlimited on a drum track — a kit is not one instrument), counting notes
 * already at the tick so a second pass cannot sneak past the limit.
 * Returns whether anything was written.
 */
export function insertChordAtCaret(
  store: EditorStoreApi,
  pitches: readonly Pitch[],
  options: {
    duration?: DurationName;
    advanceCaret?: boolean;
    /**
     * Overrides the store's `editMode` for this write.
     *
     * Editing an existing chord always stacks, whatever mode the toolbar is
     * in: `replace` would clear the very chord being edited, and `insert`
     * would shove it sideways. The mode describes entering new material, not
     * amending what is already selected.
     */
    mode?: EditMode;
  } = {},
): boolean {
  const state = store.getState();
  if (!state.score || pitches.length === 0) return false;
  const target = resolveInsertTarget(
    state.score,
    selectActiveTrackId(state),
    state.positionTick,
    state.activeVoiceIndex,
  );
  if (!target) return false;

  const track = findTrack(state.score, target.trackId);
  const existing = chordSizeAt(state.score, target.trackId, target.startTick);
  const total = existing + pitches.length;

  // Through the track rather than its program: a percussion track's program is
  // a drum kit, and reading a kit address as an instrument capped a kit at
  // whatever that instrument could play — two notes, for Brush.
  const limit = track ? trackMaxPolyphony(track) : gmMaxPolyphony(0);
  if (total > limit) {
    store.getState().pushToast({
      severity: 'warning',
      message:
        limit === 1
          ? `${track?.instrumentName ?? 'This instrument'} plays one note at a time, so this chord was not added.`
          : `${track?.instrumentName ?? 'This instrument'} plays at most ${limit} notes at once, so this chord was not added.`,
    });
    return false;
  }

  const { duration, advanceCaret = false } = options;
  const durationTicks = ticksFor(duration ?? state.snapGrid, state.score.ppq);

  const mode = options.mode ?? state.editMode;

  // `replace` has to clear the span itself. Leaving it to reflow does not
  // work: notes sharing a start AND a duration cluster into a chord, so a
  // replacement whose length happens to match what is there would silently
  // stack instead — making replace and stack the same mode most of the time.
  if (mode === 'replace') {
    // Scoped to the target voice, not the track. Clearing the span across
    // every voice would delete the other line on the stave, which is the
    // opposite of what a second voice is for.
    const targetMeasure = findTrack(state.score, target.trackId)?.measures.find(
      (measure) => measure.id === target.measureId,
    );
    const targetVoiceId = targetMeasure?.voices[target.voiceIndex]?.id;

    const occupying = allNotes(state.score)
      .filter(
        (note) =>
          note.trackId === target.trackId &&
          // An absent voice has nothing to clear, and matching every voice
          // would be worse than matching none.
          note.voiceId === targetVoiceId &&
          note.startTick < target.startTick + durationTicks &&
          note.startTick + note.durationTicks > target.startTick,
      )
      .map((note) => note.id);
    if (occupying.length > 0) dispatchTracked(store, deleteEventsCommand(occupying));
  }

  pitches.forEach((pitch, index) => {
    // Only the first note of a chord opens a gap; its siblings land in the gap
    // it made. Rippling per pitch would push the tail three beats for a triad.
    const useRipple = mode === 'insert' && index === 0;
    dispatchTracked(
      store,
      useRipple
        ? insertWithRippleCommand({
            trackId: target.trackId,
            measureId: target.measureId,
            voiceIndex: target.voiceIndex,
            pitch,
            startTick: target.startTick,
            durationTicks,
          })
        : addNoteCommand({
            trackId: target.trackId,
            measureId: target.measureId,
            voiceIndex: target.voiceIndex,
            pitch,
            startTick: target.startTick,
            durationTicks,
          }),
    );
  });

  if (advanceCaret) playbackController.seek(target.startTick + durationTicks);
  return true;
}

/**
 * "Insert rest": in this domain model a silent span is represented
 * implicitly (measures/voices are always fully covered — `reflowVoice`
 * backfills any gap with a `RestEvent`), so replacing the selected note(s)
 * with a rest is exactly deleting them. An alias of `deleteSelected` kept
 * as its own named export because it's a distinct editing *operation* per
 * spec §7's list, even though the implementation coincides.
 */
export function insertRestAtSelection(store: EditorStoreApi): void {
  deleteSelected(store);
}

// ---- transpose ----------------------------------------------------------------

/** Transposes the selected notes by one semitone (`direction` = +1 up / -1 down). No-op if no notes are selected. */
export function transposeSemitone(store: EditorStoreApi, direction: 1 | -1): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(store, transposeCommand(ids, direction));
}

/** Transposes the selected notes by one octave (`direction` = +1 up / -1 down). No-op if no notes are selected. */
export function transposeOctave(store: EditorStoreApi, direction: 1 | -1): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(store, transposeCommand(ids, direction * 12));
}

// ---- arrow-key selection movement ---------------------------------------------

/**
 * Finds the event immediately before/after `eventId` within the same
 * track and voice-ordinal "channel" (spec §25 convention — voice identity
 * doesn't persist across measures, but position-within-`measure.voices`
 * does), concatenating that channel's events across every measure of the
 * track in tick order. Returns `null` at either end of the channel, or if
 * `eventId` doesn't resolve.
 */
export function findAdjacentEventId(
  score: Score,
  eventId: UUID,
  direction: 'prev' | 'next',
): UUID | null {
  for (const track of score.tracks) {
    for (
      let voiceIndex = 0;
      voiceIndex < (track.measures[0]?.voices.length ?? 0);
      voiceIndex += 1
    ) {
      const channel: MusicalEvent[] = [];
      for (const measure of track.measures) {
        const voice = measure.voices[voiceIndex];
        if (voice) channel.push(...voice.events);
      }
      const index = channel.findIndex((e) => e.id === eventId);
      if (index === -1) continue;
      const adjacent = direction === 'next' ? channel[index + 1] : channel[index - 1];
      return adjacent?.id ?? null;
    }
  }
  return null;
}

/**
 * Moves the selection to the adjacent event in the same voice (spec §7:
 * "ArrowLeft/ArrowRight: move selection backward/forward"). If nothing is
 * currently selected, seeds the selection with the score's first note
 * (`next`) or last note (`prev`) instead of no-op'ing, so arrow keys work
 * as a first interaction too.
 */
export function moveSelectionHorizontal(store: EditorStoreApi, direction: 'prev' | 'next'): void {
  const state = store.getState();
  if (!state.score) return;

  const anchor = state.selection.eventIds[0];
  if (!anchor) {
    const notes = allNotes(state.score);
    if (notes.length === 0) return;
    const seed = direction === 'next' ? notes[0] : notes[notes.length - 1];
    state.setSelection({ eventIds: [seed.id], measureIds: [], trackIds: [] });
    return;
  }

  const adjacentId = findAdjacentEventId(state.score, anchor, direction);
  if (!adjacentId) return;
  state.setSelection({ eventIds: [adjacentId], measureIds: [], trackIds: [] });
}

// ---- delete / duplicate --------------------------------------------------------

/** Deletes the currently selected notes (spec §7 "Delete: delete selected notes") and clears the selection. No-op if no notes are selected. */
export function deleteSelected(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(store, deleteEventsCommand(ids));
  state.clearSelection();
}

/** Appends one empty measure to every track, so the barlines stay aligned. */
export function addMeasure(store: EditorStoreApi): void {
  if (!store.getState().score) return;
  dispatchTracked(store, addMeasureCommand());
}

/**
 * Removes the measure the caret is in, from every track.
 *
 * Refuses to remove the last one: a score with no measures has nothing to draw
 * and no measure for the caret to sit in, and there would be no control left
 * to undo it with except undo itself.
 */
export function deleteMeasureAtCaret(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;

  const track = state.score.tracks[0];
  if (!track || track.measures.length <= 1) {
    state.pushToast({
      severity: 'warning',
      message: 'A score needs at least one measure, so this one was kept.',
    });
    return;
  }

  const tick = Math.max(0, state.positionTick);
  const measure =
    track.measures.find((m) => tick >= m.startTick && tick < m.startTick + m.durationTicks) ??
    track.measures[track.measures.length - 1];

  dispatchTracked(store, deleteMeasureCommand(measure.index));
}

/**
 * Deletes specific notes by id, leaving the selection alone.
 *
 * Distinct from `deleteSelected`, which clears the selection afterwards: the
 * keyboard removes one note from a selected chord and the rest of that chord
 * must stay selected, or every subsequent key press would fall back to entry
 * mode mid-edit.
 */
export function deleteEvents(store: EditorStoreApi, eventIds: UUID[]): void {
  if (eventIds.length === 0) return;
  dispatchTracked(store, deleteEventsCommand(eventIds));
}

/** Duplicates the currently selected notes immediately after their own latest end tick, on the same track (voice 0 — MVP scope, see brief). No-op if no notes are selected. */
export function duplicateSelected(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;
  const notes = state.selection.eventIds
    .map((id) => findEvent(state.score!, id))
    .filter((e): e is NoteEvent => e !== null && isNoteEvent(e));
  if (notes.length === 0) return;

  const trackId = notes[0].trackId;
  const anchorTick = Math.max(...notes.map((n) => n.startTick + n.durationTicks));
  dispatchTracked(store, pasteEventsCommand(notes, { trackId, voiceIndex: 0, anchorTick }));
}

// ---- select all / measure / track ----------------------------------------------

/** Selects every note event in the score. */
export function selectAll(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;
  state.setSelection({
    eventIds: allNotes(state.score).map((n) => n.id),
    measureIds: [],
    trackIds: [],
  });
}

/** Thin wrapper for symmetry with `selectAll`/`selectTrackAction` — delegates straight to the store action. */
export function selectMeasure(store: EditorStoreApi, measureId: UUID): void {
  store.getState().selectMeasures([measureId]);
}

/** Thin wrapper for symmetry with `selectAll`/`selectMeasure` — delegates straight to the store action. */
export function selectTrackAction(store: EditorStoreApi, trackId: UUID): void {
  store.getState().selectTrack(trackId);
}

// ---- per-note property changes -------------------------------------------------

/** Sets the selected notes' duration. No-op if no notes are selected. */
export function changeDuration(store: EditorStoreApi, duration: DurationName): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(store, changeDurationCommand(ids, duration));
}

/** Sets the selected notes' velocity (0-127). No-op if no notes are selected. */
export function changeVelocity(store: EditorStoreApi, velocity: number): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(store, changeVelocityCommand(ids, velocity));
}

/** Sets (or clears, with `undefined`) the selected notes' articulation. No-op if no notes are selected. */
export function changeArticulation(
  store: EditorStoreApi,
  articulation: Articulation | undefined,
): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(store, changeArticulationCommand(ids, articulation));
}

/** Sets the selected notes' accidental. No-op if no notes are selected. */
export function changeAccidental(store: EditorStoreApi, accidental: Accidental): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(store, changeAccidentalCommand(ids, accidental));
}

/** Toggles `tieStart`/`tieStop` on the selected notes. No-op if no notes are selected. */
export function toggleTie(store: EditorStoreApi, which: 'tieStart' | 'tieStop'): void {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  dispatchTracked(store, toggleTieCommand(ids, which));
}

// ---- quantize -------------------------------------------------------------------

/**
 * Note-count threshold (spec §29: route a manual quantize of >2000 events
 * through a worker) above which `runQuantize` sends the actual
 * `quantizeEvents` work to `QuantizeService`'s worker instead of running it
 * inline on the main thread. Measured as the total note count across every
 * voice the action touches (`collectQuantizeTargets`'s output), not just
 * `eventIds.length` — that's what `quantizeEvents` actually has to process
 * per voice, and is the more direct proxy for "how much main-thread work
 * would this block."
 */
const QUANTIZE_WORKER_THRESHOLD = 2000;

/**
 * Quantizes every voice touched by `eventIds` against `options` — the
 * shared implementation behind both `quantizeSelection` (score editor) and
 * `interactions.ts`'s `commitQuantize` (piano roll), so the >2000-event
 * worker-routing decision (spec §29) lives in exactly one place.
 *
 * Below the threshold, dispatches the ordinary synchronous `quantizeCommand`
 * — byte-for-byte the pre-Task-17 behavior, and since this function's own
 * body has no `await` before that dispatch, it still happens synchronously
 * within the call (an `async` function runs synchronously up to its first
 * `await`), so callers that don't `await` the returned promise (existing
 * tests, and the toolbar `onClick` handlers) see the same command-dispatched-
 * immediately behavior as before this task.
 *
 * Above the threshold, `collectQuantizeTargets` (cheap: no `quantizeEvents`
 * call) runs synchronously to snapshot which voices/notes are involved,
 * then the actual quantization is sent to `service` — a real worker thread
 * in the browser, a direct (but still off-the-critical-path) fallback call
 * under vitest/jsdom, per `QuantizeService`'s doc comment — and the result
 * applied via `applyQuantizedCommand`, which is itself synchronous/pure
 * like every other `ScoreCommand` (spec §14): the *command* never awaits
 * anything, only this intent-layer wrapper does.
 */
export async function runQuantize(
  store: EditorStoreApi,
  score: Score,
  eventIds: UUID[],
  options: QuantizeOptions,
  service: QuantizeService = getQuantizeService(),
): Promise<void> {
  const targets = collectQuantizeTargets(score, eventIds);
  const totalNotes = targets.reduce((sum, target) => sum + target.notes.length, 0);

  if (totalNotes <= QUANTIZE_WORKER_THRESHOLD) {
    dispatchTracked(store, quantizeCommand(eventIds, options));
    return;
  }

  const quantizedByVoiceId = await service.quantizeGroups(
    targets.map((target) => ({ key: target.voiceId, events: target.notes })),
    options,
  );
  dispatchTracked(store, applyQuantizedCommand(targets, quantizedByVoiceId));
}

/** Quantizes the voice(s) containing the selected notes. No-op if no notes are selected. See `runQuantize` for the >2000-event worker-routing this delegates to. */
export async function quantizeSelection(
  store: EditorStoreApi,
  options: QuantizeOptions,
  service?: QuantizeService,
): Promise<void> {
  const state = store.getState();
  if (!state.score) return;
  const ids = selectedNoteIds(state.score, state.selection);
  if (ids.length === 0) return;
  await runQuantize(store, state.score, ids, options, service ?? getQuantizeService());
}
