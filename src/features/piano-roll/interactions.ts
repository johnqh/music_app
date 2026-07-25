/**
 * UI-intent -> store-command mapping for the piano roll (spec §8), mirroring
 * the score editor's `editing.ts` (Task 12): every function here takes the
 * store's bound API and reads fresh state via `store.getState()`, so it's
 * safe to call from an event handler and directly unit-testable against a
 * real store instance without rendering React.
 *
 * The piano roll dispatches the exact same command factories
 * (`@/domain/commands/note-commands`, `edit-commands`) as the notation
 * view, through the score editor's own `dispatchTracked` (same validation-
 * toast behavior) — there is no piano-roll-local note state or a separate
 * mutation path.
 */
import type { UUID, Measure, Score, Track } from '@/domain/score/types';
import type { ScoreSelection } from '@/domain/selection/types';
import { findEvent, findTrack } from '@/domain/score/queries';
import { selectionToRange } from '@/domain/selection/selection';
import { ticksFor } from '@/domain/time/ticks';
import { midiToPitch } from '@/domain/pitch/pitch';
import {
  addNoteCommand,
  changeVelocityCommand,
  changeVoiceCommand,
  deleteEventsCommand,
  moveNotesCommand,
  resizeNotesCommand,
} from '@/domain/commands/note-commands';
import type { MoveNotesParams } from '@/domain/commands/note-commands';
import { quantizeCommand } from '@/domain/commands/edit-commands';
import type { QuantizeOptions } from '@/domain/quantization/options';
import { dispatchTracked } from '@/features/score-editor/editing';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { snapTick } from '@/features/piano-roll/geometry';

export type { EditorStoreApi } from '@/features/score-editor/editing';

/** Piano-roll voice-lane strip shows at most this many rows (spec §8 "move notes between tracks" — see module doc below for why this maps to voice, not track, reassignment). */
export const MAX_VOICE_LANES = 4;

// ---- move / resize / velocity / voice / delete ---------------------------------------

/** Moves the given notes by `params.deltaTicks`/`deltaSemitones` as one undoable command (a piano-roll horizontal+vertical note drag). No-op with no ids or a zero delta. */
export function commitMove(store: EditorStoreApi, eventIds: UUID[], params: MoveNotesParams): void {
  if (eventIds.length === 0) return;
  if (params.deltaTicks === 0 && params.deltaSemitones === 0) return;
  dispatchTracked(store, moveNotesCommand(eventIds, params));
}

/** Sets the given notes' duration from a right-edge resize drag, clamped to at least 1 tick. No-op with no ids. */
export function commitResize(store: EditorStoreApi, eventIds: UUID[], durationTicks: number): void {
  if (eventIds.length === 0) return;
  const clamped = Math.max(1, Math.round(durationTicks));
  dispatchTracked(store, resizeNotesCommand(eventIds, clamped));
}

/** Sets the given notes' velocity from a velocity-lane bar drag, clamped to the valid MIDI range [0, 127]. No-op with no ids. */
export function commitVelocity(store: EditorStoreApi, eventIds: UUID[], velocity: number): void {
  if (eventIds.length === 0) return;
  const clamped = Math.max(0, Math.min(127, Math.round(velocity)));
  dispatchTracked(store, changeVelocityCommand(eventIds, clamped));
}

/**
 * Moves the given notes to voice `targetVoiceIndex` of their own current
 * measure — the piano roll's "drag onto another track row region"
 * interaction (spec §8). The domain layer has no cross-*track* move
 * command (a `NoteEvent.trackId` is fixed at creation; only
 * `changeVoiceCommand` relocates a note within its own track), so the
 * piano roll's voice-lane strip is scoped to voice reassignment on the
 * dragged note's existing track, which is the mechanism actually available
 * — matching the brief's own "changeVoiceCommand/track move" phrasing.
 */
export function commitVoiceChange(store: EditorStoreApi, eventIds: UUID[], targetVoiceIndex: number): void {
  if (eventIds.length === 0) return;
  dispatchTracked(store, changeVoiceCommand(eventIds, targetVoiceIndex));
}

/** Deletes the given notes and clears the selection (Delete is also handled globally by the score editor's shortcut hook; this is for any piano-roll-local delete affordance, e.g. a context menu). No-op with no ids. */
export function commitDelete(store: EditorStoreApi, eventIds: UUID[]): void {
  if (eventIds.length === 0) return;
  dispatchTracked(store, deleteEventsCommand(eventIds));
  store.getState().clearSelection();
}

/** Quantizes the voice(s) containing the given notes. No-op with no ids. */
export function commitQuantize(store: EditorStoreApi, eventIds: UUID[], options: QuantizeOptions): void {
  if (eventIds.length === 0) return;
  dispatchTracked(store, quantizeCommand(eventIds, options));
}

// ---- add note (double-click empty cell) ----------------------------------------------

/** The measure on `track` whose span covers `tick` (`startTick <= tick < startTick + durationTicks`), or `null` if none does (including exactly at the track's end tick). */
export function findMeasureAtTick(track: Track, tick: number): Measure | null {
  return track.measures.find((m) => tick >= m.startTick && tick < m.startTick + m.durationTicks) ?? null;
}

export type AddNoteAtCellParams = { trackId: UUID; tick: number; midi: number; voiceIndex?: number };

/**
 * Adds a note on `params.trackId` at the grid cell under `params.tick`/
 * `params.midi` (a piano-roll double-click on an empty cell), snapped to
 * the store's current `snapGrid` and using it as the new note's duration
 * (mirroring the score editor's `insertNoteAtSelection`). No-op if there's
 * no score, the track doesn't exist, or the snapped tick falls outside
 * every measure on that track.
 */
export function addNoteAtCell(store: EditorStoreApi, params: AddNoteAtCellParams): void {
  const state = store.getState();
  const score = state.score;
  if (!score) return;
  const track = findTrack(score, params.trackId);
  if (!track) return;

  const durationTicks = ticksFor(state.snapGrid, score.ppq);
  const snappedTick = snapTick(params.tick, durationTicks);
  const measure = findMeasureAtTick(track, snappedTick);
  if (!measure) return;

  const pitch = midiToPitch(params.midi, measure.keySignature);
  dispatchTracked(
    store,
    addNoteCommand({
      trackId: track.id,
      measureId: measure.id,
      voiceIndex: params.voiceIndex ?? 0,
      pitch,
      startTick: snappedTick,
      durationTicks,
    }),
  );
}

// ---- track/voice resolution ------------------------------------------------------------

/**
 * The track a piano-roll action with no more specific target (e.g. a
 * double-click add) should use: the first selected event's own track (if
 * visible), else the first selected track (if visible), else the first
 * visible track in score order, else `null` if nothing qualifies.
 */
export function resolveActiveTrackId(
  score: Score,
  selection: ScoreSelection,
  visibleTrackIds: ReadonlySet<UUID> | null,
): UUID | null {
  const isVisible = (id: UUID): boolean => !visibleTrackIds || visibleTrackIds.has(id);

  for (const eventId of selection.eventIds) {
    const event = findEvent(score, eventId);
    if (event && isVisible(event.trackId)) return event.trackId;
  }
  for (const trackId of selection.trackIds) {
    if (isVisible(trackId)) return trackId;
  }
  const firstVisible = score.tracks.find((t) => isVisible(t.id));
  return firstVisible?.id ?? null;
}

/** The number of voice lanes the voice-lane strip should render: the most voices any (visible) measure actually has, at least 2 (so there's always somewhere new to drag into) and at most `MAX_VOICE_LANES`. */
export function maxVoiceCount(score: Score, visibleTrackIds: ReadonlySet<UUID> | null): number {
  let max = 1;
  for (const track of score.tracks) {
    if (visibleTrackIds && !visibleTrackIds.has(track.id)) continue;
    for (const measure of track.measures) {
      max = Math.max(max, measure.voices.length);
    }
  }
  return Math.min(MAX_VOICE_LANES, Math.max(2, max));
}

// ---- loop from selection ----------------------------------------------------------------

/**
 * Sets the transport's loop range to the current selection's tick/track
 * span (spec §8's "loop selected regions", via the shared selection model
 * — spec §9). Pushes a warning toast instead if the selection has no
 * resolvable tick extent.
 */
export function loopFromSelection(store: EditorStoreApi): void {
  const state = store.getState();
  if (!state.score) return;
  const range = selectionToRange(state.score, state.selection);
  if (!range) {
    state.pushToast({
      message: 'Select notes, measures, or a range before looping.',
      severity: 'warning',
    });
    return;
  }
  state.setLoopRange(range);
}
