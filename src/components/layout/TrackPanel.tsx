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
 * Adopts `@sudobility/components` controls (library sweep 1): the track
 * name field becomes the library `Input`, the clef `<select>` becomes the
 * library's Radix-backed `Select`, and volume/pan become the library
 * `Slider` -- wrapped to keep the exact same draft/commit semantics as
 * before (local state tracks every drag tick, the real
 * `changeTrackPropsCommand` is dispatched only once, on pointerup/keyup).
 * Mute/solo stay `Button`s with `aria-pressed` (not `Checkbox`/`Switch`):
 * they're toggle *buttons* today (an "M"/"S" glyph, no checkbox semantics),
 * matching every other toggle in this app (e.g. `TransportBar`'s Loop/
 * Metronome), so converting them to a checkbox-like control would be a
 * genuine semantics change, not an adoption of an equivalent control.
 *
 * The library `Slider` has no `aria-label`/`id` prop (a closed `SliderProps`,
 * no HTML-attribute passthrough) and no commit-on-release callback, so
 * each slider below is wrapped in a `<label>` with a visually-hidden
 * (`sr-only`) text node for its accessible name (the standard implicit
 * label-association algorithm gives the same accessible name an explicit
 * `aria-label` would have), with `onPointerUp`/`onKeyUp` on that same
 * wrapper doing the commit -- bubbled up from the Slider's own native
 * `<input type="range">`, same as the commit handlers this replaces.
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Tooltip,
  cn,
} from '@sudobility/components';
import type { Clef, Track, UUID } from '@sudobility/music_types';
import {
  addTrackCommand,
  changeClefCommand,
  changeTrackPropsCommand,
  deleteTrackCommand,
} from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

export type TrackPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
};

const CLEF_OPTIONS: Clef[] = ['treble', 'bass', 'alto', 'tenor', 'percussion'];

const ICON_BUTTON_CLASS = 'h-auto w-auto p-1.5 text-sm leading-none';

const TOGGLE_BUTTON_CLASS = cn(
  'px-2 py-1 text-xs',
  'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90',
);

/** A library `Slider` wrapped with an accessible name (via a visually-hidden
 * label, since `Slider` accepts no `aria-label`) and a commit-on-release
 * handler (since `Slider` exposes only a continuous `onChange`, no
 * `onValueCommitted`-style callback of its own). */
function CommitSlider({
  label,
  value,
  onCommit,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (
    e: ReactPointerEvent<HTMLLabelElement> | KeyboardEvent<HTMLLabelElement>,
  ): void => {
    onCommit(Number((e.target as HTMLInputElement).value));
  };

  return (
    <label className="flex-1" onPointerUp={commit} onKeyUp={commit}>
      <span className="sr-only">{label}</span>
      <Slider value={draft} onChange={setDraft} min={min} max={max} step={step} />
    </label>
  );
}

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
  onPatch: (
    patch: Partial<Pick<Track, 'name' | 'instrumentName' | 'volume' | 'pan' | 'muted' | 'solo'>>,
  ) => void;
  onChangeClef: (clef: Clef) => void;
  onDelete: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(track.name);

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
        <Input
          value={nameDraft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNameDraft(e.target.value)}
          onBlur={commitName}
          aria-label={`Track name: ${track.name}`}
          className="flex-1 border-none bg-transparent px-1 py-0.5 font-semibold text-theme-text-primary hover:bg-theme-hover-bg focus:bg-theme-hover-bg focus:ring-0"
        />
        <span
          aria-label={`Clef: ${track.clef}`}
          className="rounded-full bg-theme-bg-secondary px-2 py-0.5 text-xs text-theme-text-primary"
        >
          {track.clef}
        </span>
        <Tooltip content="Delete track">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Delete track: ${track.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className={ICON_BUTTON_CLASS}
          >
            ✕
          </Button>
        </Tooltip>
      </div>

      <p className="text-xs text-theme-text-secondary">{track.instrumentName}</p>

      <div className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Button
          type="button"
          variant="ghost"
          aria-label={`Mute: ${track.name}`}
          aria-pressed={track.muted}
          onClick={() => onPatch({ muted: !track.muted })}
          className={TOGGLE_BUTTON_CLASS}
        >
          M
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label={`Solo: ${track.name}`}
          aria-pressed={track.solo}
          onClick={() => onPatch({ solo: !track.solo })}
          className={TOGGLE_BUTTON_CLASS}
        >
          S
        </Button>
        <Select value={track.clef} onValueChange={(value) => onChangeClef(value as Clef)}>
          <SelectTrigger
            aria-label={`Clef select: ${track.name}`}
            className="h-auto w-auto min-w-[90px] px-2 py-1 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLEF_OPTIONS.map((clef) => (
              <SelectItem key={clef} value={clef}>
                {clef}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-[30px] text-xs text-theme-text-secondary">Vol</span>
        <CommitSlider
          label={`Volume: ${track.name}`}
          value={track.volume}
          onCommit={(volume) => onPatch({ volume })}
          min={0}
          max={1}
          step={0.01}
        />
      </div>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-[30px] text-xs text-theme-text-secondary">Pan</span>
        <CommitSlider
          label={`Pan: ${track.name}`}
          value={track.pan}
          onCommit={(pan) => onPatch({ pan })}
          min={-1}
          max={1}
          step={0.01}
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
    store
      .getState()
      .dispatchCommand(addTrackCommand({ name: `Track ${tracks.length + 1}`, clef: 'treble' }));
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex items-center border-b border-theme-border p-2">
        <span className="flex-1 text-sm font-semibold text-theme-text-primary">Tracks</span>
        <Tooltip content="Add track">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Add track"
            onClick={handleAddTrack}
            className={ICON_BUTTON_CLASS}
          >
            +
          </Button>
        </Tooltip>
      </div>

      <div role="list" aria-label="Track list">
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            selected={selectedTrackIds.includes(track.id)}
            onSelect={() => store.getState().selectTrack(track.id)}
            onPatch={(patch) =>
              store.getState().dispatchCommand(changeTrackPropsCommand(track.id, patch))
            }
            onChangeClef={(clef) =>
              store.getState().dispatchCommand(changeClefCommand(track.id, clef))
            }
            onDelete={() => setPendingDeleteId(track.id)}
          />
        ))}
      </div>

      <ConfirmDialog
        open={pendingDeleteTrack !== null}
        title="Delete track"
        message={
          pendingDeleteTrack
            ? `Delete "${pendingDeleteTrack.name}"? This cannot be undone after saving.`
            : ''
        }
        confirmLabel="Delete"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId)
            store.getState().dispatchCommand(deleteTrackCommand(pendingDeleteId));
          setPendingDeleteId(null);
        }}
      />
    </div>
  );
}
