/**
 * Left-hand track panel (spec §6, §20): one row per track — editable name,
 * instrument, mute/solo toggles, volume/pan sliders, a clef chip — plus
 * add/delete track (delete confirmed) and click-to-select-track.
 *
 * Mute/solo dispatch `changeTrackPropsCommand` (a real, undoable, persisted
 * score edit) rather than any engine-only override: the live playback
 * engine reseeds its per-track mute/solo state straight from `Track` on
 * every `loadScore` (any edit, undo/redo, import, generation accept), so
 * an engine-only override would silently revert on the next unrelated
 * edit. Routing through the score is also what makes mute/solo undoable
 * and persisted with the project, matching every other track property.
 *
 * Re-skinned onto Tailwind + @sudobility/components (T12 batch 3): the MUI
 * Select becomes a native `<select>`, MUI ToggleButtons become plain
 * buttons with `aria-pressed`, and the MUI Slider becomes a native
 * `<input type="range">` with the same draft/commit semantics -- local
 * state tracks every drag tick, and the real `changeTrackPropsCommand` is
 * dispatched only once, on pointerup or keyup (a native range input's
 * equivalent of MUI's `onChangeCommitted`).
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { Tooltip } from '@sudobility/components';
import type { Clef, Track, UUID } from '@sudobility/music_types';
import { addTrackCommand, changeClefCommand, changeTrackPropsCommand, deleteTrackCommand } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

export type TrackPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
};

const CLEF_OPTIONS: Clef[] = ['treble', 'bass', 'alto', 'tenor', 'percussion'];

const ICON_BUTTON_CLASS =
  'rounded-md p-1.5 text-sm leading-none text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-40';

const TOGGLE_BUTTON_CLASS =
  'rounded-md px-2 py-1 text-xs font-medium text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90';

const SELECT_CLASS = 'rounded-md border border-theme-border bg-theme-bg-primary px-2 py-1 text-xs text-theme-text-primary';

function TrackRow({
  track,
  selected,
  onSelect,
  onPatch,
  onChangeClef,
  onDelete,
}: {
  track: Track;
  selected: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<Pick<Track, 'name' | 'instrumentName' | 'volume' | 'pan' | 'muted' | 'solo'>>) => void;
  onChangeClef: (clef: Clef) => void;
  onDelete: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(track.name);
  // Local drag drafts (spec §22-adjacent slider convention, also used by
  // InspectorPanel's track sliders): a native range input's onChange fires
  // on every drag tick, not just at the end. Dispatching a ScoreCommand per
  // tick would flood undo history (one drag = dozens of entries) and re-run
  // validateScore/markDirty that often; the command is dispatched once,
  // from onPointerUp/onKeyUp (drag-release/keyboard-commit), while these
  // drafts keep the thumb tracking the drag live. Synced back to the
  // track's real value on any external change (undo/redo, another client,
  // the commit itself echoing back).
  const [volumeDraft, setVolumeDraft] = useState(track.volume);
  const [panDraft, setPanDraft] = useState(track.pan);

  useEffect(() => setVolumeDraft(track.volume), [track.volume]);
  useEffect(() => setPanDraft(track.pan), [track.pan]);

  const commitName = (): void => {
    if (nameDraft.trim() !== '' && nameDraft !== track.name) onPatch({ name: nameDraft.trim() });
    else setNameDraft(track.name);
  };

  return (
    <div
      role="listitem"
      aria-label={`Track: ${track.name}`}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        // Guard against the nested track-name input: keydown bubbles, so
        // without this, pressing Space/Enter while typing a track name
        // would also re-trigger row selection.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer border-b border-theme-border p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
        selected ? 'bg-theme-bg-secondary' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <input
          value={nameDraft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNameDraft(e.target.value)}
          onBlur={commitName}
          aria-label={`Track name: ${track.name}`}
          className="flex-1 rounded bg-transparent px-1 py-0.5 font-semibold text-theme-text-primary outline-none hover:bg-theme-hover-bg focus:bg-theme-hover-bg"
        />
        <span
          aria-label={`Clef: ${track.clef}`}
          className="rounded-full bg-theme-bg-secondary px-2 py-0.5 text-xs text-theme-text-primary"
        >
          {track.clef}
        </span>
        <Tooltip content="Delete track">
          <button
            type="button"
            aria-label={`Delete track: ${track.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className={ICON_BUTTON_CLASS}
          >
            ✕
          </button>
        </Tooltip>
      </div>

      <p className="text-xs text-theme-text-secondary">{track.instrumentName}</p>

      <div className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label={`Mute: ${track.name}`}
          aria-pressed={track.muted}
          onClick={() => onPatch({ muted: !track.muted })}
          className={TOGGLE_BUTTON_CLASS}
        >
          M
        </button>
        <button
          type="button"
          aria-label={`Solo: ${track.name}`}
          aria-pressed={track.solo}
          onClick={() => onPatch({ solo: !track.solo })}
          className={TOGGLE_BUTTON_CLASS}
        >
          S
        </button>
        <select
          aria-label={`Clef select: ${track.name}`}
          value={track.clef}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onChangeClef(e.target.value as Clef)}
          className={`min-w-[90px] ${SELECT_CLASS}`}
        >
          {CLEF_OPTIONS.map((clef) => (
            <option key={clef} value={clef}>
              {clef}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-[30px] text-xs text-theme-text-secondary">Vol</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volumeDraft}
          aria-label={`Volume: ${track.name}`}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setVolumeDraft(Number(e.target.value))}
          onPointerUp={(e) => onPatch({ volume: Number(e.currentTarget.value) })}
          onKeyUp={(e) => onPatch({ volume: Number(e.currentTarget.value) })}
          className="flex-1"
        />
      </div>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-[30px] text-xs text-theme-text-secondary">Pan</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={panDraft}
          aria-label={`Pan: ${track.name}`}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPanDraft(Number(e.target.value))}
          onPointerUp={(e) => onPatch({ pan: Number(e.currentTarget.value) })}
          onKeyUp={(e) => onPatch({ pan: Number(e.currentTarget.value) })}
          className="flex-1"
        />
      </div>
    </div>
  );
}

export function TrackPanel({ store = useAppStore }: TrackPanelProps) {
  const score = store((s) => s.score);
  const selectedTrackIds = store((s) => s.selection.trackIds);
  const [pendingDeleteId, setPendingDeleteId] = useState<UUID | null>(null);

  if (!score) return null;
  const tracks = score.tracks;
  const pendingDeleteTrack = tracks.find((t) => t.id === pendingDeleteId) ?? null;

  const handleAddTrack = (): void => {
    store.getState().dispatchCommand(addTrackCommand({ name: `Track ${tracks.length + 1}`, clef: 'treble' }));
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex items-center border-b border-theme-border p-2">
        <span className="flex-1 text-sm font-semibold text-theme-text-primary">Tracks</span>
        <Tooltip content="Add track">
          <button type="button" aria-label="Add track" onClick={handleAddTrack} className={ICON_BUTTON_CLASS}>
            +
          </button>
        </Tooltip>
      </div>

      <div role="list" aria-label="Track list">
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            selected={selectedTrackIds.includes(track.id)}
            onSelect={() => store.getState().selectTrack(track.id)}
            onPatch={(patch) => store.getState().dispatchCommand(changeTrackPropsCommand(track.id, patch))}
            onChangeClef={(clef) => store.getState().dispatchCommand(changeClefCommand(track.id, clef))}
            onDelete={() => setPendingDeleteId(track.id)}
          />
        ))}
      </div>

      <ConfirmDialog
        open={pendingDeleteTrack !== null}
        title="Delete track"
        message={pendingDeleteTrack ? `Delete "${pendingDeleteTrack.name}"? This cannot be undone after saving.` : ''}
        confirmLabel="Delete"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) store.getState().dispatchCommand(deleteTrackCommand(pendingDeleteId));
          setPendingDeleteId(null);
        }}
      />
    </div>
  );
}
