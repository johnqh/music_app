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
import type { Accidental, Articulation, DurationName, NoteEvent, Pitch, Score, UUID } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import type { MusicalEvent } from '@sudobility/music_types';
import type { ScoreSelection } from '@sudobility/music_lib';
import type { ScoreCommand } from '@sudobility/music_lib';
import type { ValidationIssue } from '@sudobility/music_lib';
import { allNotes, findEvent, findTrack } from '@sudobility/music_lib';
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

/** Locates an event's owning track/measure/voice-ordinal-index and its own startTick. */
function locateEvent(
  score: Score,
  eventId: UUID,
): { trackId: UUID; measureId: UUID; voiceIndex: number; startTick: number } | null {
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      for (let voiceIndex = 0; voiceIndex < measure.voices.length; voiceIndex += 1) {
        const event = measure.voices[voiceIndex].events.find((e) => e.id === eventId);
        if (event) {
          return { trackId: track.id, measureId: measure.id, voiceIndex, startTick: event.startTick };
        }
      }
    }
  }
  return null;
}

/**
 * Resolves where an insert/rest action should target, from (in priority
 * order): the first selected event's own position; the first selected
 * measure's start; the first selected track's first measure; else the
 * score's very first measure. `null` only if the score has no measures at
 * all on any candidate track.
 */
export function resolveInsertTarget(score: Score, selection: ScoreSelection): InsertTarget | null {
  for (const eventId of selection.eventIds) {
    const located = locateEvent(score, eventId);
    if (located) return located;
  }

  for (const measureId of selection.measureIds) {
    const owner = score.tracks.find((t) => t.measures.some((m) => m.id === measureId));
    const measure = owner?.measures.find((m) => m.id === measureId);
    if (owner && measure) {
      return { trackId: owner.id, measureId, voiceIndex: 0, startTick: measure.startTick };
    }
  }

  for (const trackId of selection.trackIds) {
    const track = findTrack(score, trackId);
    if (track?.measures[0]) {
      return { trackId, measureId: track.measures[0].id, voiceIndex: 0, startTick: track.measures[0].startTick };
    }
  }

  const track = score.tracks[0];
  if (!track?.measures[0]) return null;
  return { trackId: track.id, measureId: track.measures[0].id, voiceIndex: 0, startTick: track.measures[0].startTick };
}

/**
 * Inserts a note at the current selection's implied measure+beat (see
 * `resolveInsertTarget`), using the store's current `snapGrid` as the
 * note's duration. No-op if there's no score or no resolvable target.
 */
export function insertNoteAtSelection(store: EditorStoreApi, pitch: Pitch, articulation?: Articulation): void {
  const state = store.getState();
  if (!state.score) return;
  const target = resolveInsertTarget(state.score, state.selection);
  if (!target) return;

  const durationTicks = ticksFor(state.snapGrid, state.score.ppq);
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
export function findAdjacentEventId(score: Score, eventId: UUID, direction: 'prev' | 'next'): UUID | null {
  for (const track of score.tracks) {
    for (let voiceIndex = 0; voiceIndex < (track.measures[0]?.voices.length ?? 0); voiceIndex += 1) {
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
  state.setSelection({ eventIds: allNotes(state.score).map((n) => n.id), measureIds: [], trackIds: [] });
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
export function changeArticulation(store: EditorStoreApi, articulation: Articulation | undefined): void {
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
