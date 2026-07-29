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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { selectActiveTrackId, useAppStore } from '@sudobility/music_lib';
import {
  GM_FAMILIES,
  GM_FAMILY_LABELS,
  gmInstrument,
  gmInstrumentsByFamily,
} from '@sudobility/music_lib';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';
import type { StaveRect } from '@/features/score-editor/stave-layout';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

export type TrackPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /**
   * Stave rects reported by the notation view, in client coordinates. When
   * present, rows are absolutely positioned to line up with their staves on
   * the sheet; when absent (no score, or before the first layout) rows stack
   * normally, which is also what most of this suite exercises.
   */
  staveRects?: readonly StaveRect[];
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
  active,
  rect,
  listTop,
  onSelect,
  onPatch,
  onChangeClef,
  onDelete,
}: {
  track: Track;
  selected: boolean;
  /** The track the caret, the piano roll, and the notation's stave coloring follow. Distinct from `selected`, which is a score selection. */
  active: boolean;
  onSelect: () => void;
  onPatch: (
    patch: Partial<
      Pick<Track, 'name' | 'instrumentName' | 'midiProgram' | 'volume' | 'pan' | 'muted' | 'solo'>
    >,
  ) => void;
  onChangeClef: (clef: Clef) => void;
  onDelete: () => void;
  /** This track's stave rect in client coordinates, or `null` when not aligning. */
  rect: { top: number; height: number } | null;
  /** Client-space top of the list container, for converting `rect.top` to panel-local. */
  listTop: number;
}) {
  const [nameDraft, setNameDraft] = useState(track.name);

  const commitName = (): void => {
    if (nameDraft.trim() !== '' && nameDraft !== track.name) onPatch({ name: nameDraft.trim() });
    else setNameDraft(track.name);
  };

  return (
    <div
      role="listitem"
      data-testid={`track-row-${track.id}`}
      aria-label={`Track: ${track.name}`}
      aria-current={active ? 'true' : undefined}
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
      style={
        rect
          ? {
              position: 'absolute',
              left: 0,
              right: 0,
              // Client -> panel-local.
              top: rect.top - listTop,
              height: rect.height,
              // Clipped so a short stave can never push the row out of
              // alignment; hover and the active row lift instead (below).
              overflow: 'hidden',
            }
          : undefined
      }
      className={cn(
        'cursor-pointer border-b border-theme-border p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary',
        selected && 'bg-theme-bg-secondary',
        // The active track gets a left rail rather than another background
        // tint, so "active" stays readable on top of "selected".
        active && 'border-l-2 border-l-primary',
        // A stave shorter than the controls clips them; lifting the row above
        // its neighbours is how they stay reachable. `!h-auto` because the
        // height is an inline style and only an important utility beats it.
        // Alignment breaks for this one row while lifted, deliberately -- every
        // other row keeps it, and this one snaps back on pointer-out.
        rect && 'bg-theme-bg hover:z-10 hover:!h-auto hover:overflow-visible hover:shadow-lg',
        rect && active && 'z-10 !h-auto overflow-visible',
      )}
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

      {/* Sets both fields together: `instrumentName` is free text and could
          previously drift from `midiProgram`. The catalogue name is now the
          single source of both. `stopPropagation` matches the mute/solo row,
          so opening the picker doesn't also select the track. */}
      <div className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <InstrumentIcon program={track.midiProgram} className="text-sm" />
        <Select
          value={String(track.midiProgram)}
          onValueChange={(value: string) => {
            const program = Number(value);
            const instrument = gmInstrument(program);
            if (!instrument) return;
            onPatch({ midiProgram: program, instrumentName: instrument.name });
          }}
        >
          <SelectTrigger
            aria-label={`Instrument: ${track.name}`}
            className="h-auto w-full px-1 py-0.5 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GM_FAMILIES.map((family) => (
              <SelectGroup key={family}>
                <SelectLabel>{GM_FAMILY_LABELS[family]}</SelectLabel>
                {gmInstrumentsByFamily(family).map((instrument) => (
                  <SelectItem key={instrument.program} value={String(instrument.program)}>
                    {instrument.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

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

export function TrackPanel({ store = useAppStore, staveRects }: TrackPanelProps) {
  const score = store((s) => s.score);
  const selectedTrackIds = store((s) => s.selection.trackIds);
  const activeTrackId = store(selectActiveTrackId);
  const [pendingDeleteId, setPendingDeleteId] = useState<UUID | null>(null);

  const rectByTrackId = useMemo(
    () => new Map((staveRects ?? []).map((rect) => [rect.trackId, rect])),
    [staveRects],
  );
  const aligned = rectByTrackId.size > 0;

  /**
   * The rects arrive in client coordinates (the notation view has a different
   * origin and a toolbar above it), so the panel measures its own top and
   * converts. Layout effect, not state-on-render: this reads geometry.
   */
  const listRef = useRef<HTMLDivElement | null>(null);
  const [listTop, setListTop] = useState(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) setListTop(el.getBoundingClientRect().top);
  }, [aligned, staveRects]);

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

      <div
        ref={listRef}
        role="list"
        aria-label="Track list"
        // `relative` only while aligning: the rows are absolutely positioned
        // against this box, and it must not scroll independently -- it mirrors
        // one system of the sheet rather than being its own scrollable list.
        className={aligned ? 'relative' : undefined}
      >
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            rect={rectByTrackId.get(track.id) ?? null}
            listTop={listTop}
            track={track}
            selected={selectedTrackIds.includes(track.id)}
            active={track.id === activeTrackId}
            onSelect={() => {
              // Both: selecting a track in the panel is also how you choose
              // which track the piano roll shows, since the roll displays the
              // active track alone and the notation may not have that stave
              // conveniently on screen.
              store.getState().setActiveTrack(track.id);
              store.getState().selectTrack(track.id);
            }}
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
