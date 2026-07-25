/**
 * Piano-roll toolbar (spec §8): independent horizontal/vertical zoom,
 * snap-grid select (shared with the notation view's `uiSlice.snapGrid`),
 * quantize, a per-track visibility filter, "loop selection", and the same
 * notation/piano-roll view switch `EditorToolbar` shows (spec §6/§8: the
 * two views are meant to be freely interchangeable -- without a matching
 * control here, switching to the piano roll would strand the user with no
 * way back to notation, since `EditorToolbar` itself only mounts while
 * `view === 'notation'`).
 *
 * Zoom is piano-roll-local view state (owned by `PianoRollView`, passed
 * down as props — same pattern as `ScoreEditorView`'s `layoutMode`): it's
 * display scale, not note data, so keeping it outside the store doesn't
 * violate the "no view-local note state" rule. Every control that mutates
 * the score routes through `interactions.ts` (never `store.dispatchCommand`
 * directly), matching the score editor's `EditorToolbar`.
 *
 * Re-skinned onto Tailwind + @sudobility/components (T12 batch 2): the MUI
 * snap-grid Select becomes a native `<select>`; the MUI multi-select track
 * filter (a combobox opening a checkbox listbox) becomes a hand-built
 * `role="combobox"` trigger + `role="listbox"`/`role="option"` popover with
 * a real checkbox in every option, keeping the same roles/accessible names
 * the MUI version produced.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Tooltip } from '@sudobility/components';
import type { DurationName, UUID } from '@sudobility/music_types';
import { ticksFor } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { selectedNoteIds } from '@/features/score-editor/editing';
import { commitQuantize, loopFromSelection } from '@/features/piano-roll/interactions';

export type PianoRollToolbarProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  zoomH: number;
  zoomV: number;
  onZoomHChange: (zoom: number) => void;
  onZoomVChange: (zoom: number) => void;
  /** Track ids currently shown in the roll; `null` means "every track" (no filter applied). */
  visibleTrackIds: Set<UUID> | null;
  onVisibleTrackIdsChange: (ids: Set<UUID> | null) => void;
};

const SNAP_OPTIONS: DurationName[] = ['whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirtysecond'];

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

const ICON_BUTTON_CLASS =
  'rounded-md p-1.5 text-sm leading-none text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-40';

const TOGGLE_BUTTON_CLASS =
  'rounded-md px-2 py-1 text-sm font-medium text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90';

const TEXT_BUTTON_CLASS =
  'rounded-md border border-theme-border px-3 py-1.5 text-sm text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-40';

const SELECT_CLASS = 'rounded-md border border-theme-border bg-theme-bg-primary px-2 py-1.5 text-sm text-theme-text-primary';

function VerticalDivider() {
  return <div className="mx-1 h-6 w-px shrink-0 self-center bg-theme-border" aria-hidden="true" />;
}

export function PianoRollToolbar({
  store = useAppStore,
  zoomH,
  zoomV,
  onZoomHChange,
  onZoomVChange,
  visibleTrackIds,
  onVisibleTrackIdsChange,
}: PianoRollToolbarProps) {
  const score = store((s) => s.score);
  const snapGrid = store((s) => s.snapGrid);
  const view = store((s) => s.view);
  const hasScore = score !== null;
  const trackIds = useMemo(() => score?.tracks.map((t) => t.id) ?? [], [score]);
  const selectedTrackIds = visibleTrackIds ?? new Set(trackIds);

  const [trackFilterOpen, setTrackFilterOpen] = useState(false);
  const trackFilterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!trackFilterOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!trackFilterRef.current?.contains(event.target as Node)) setTrackFilterOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [trackFilterOpen]);

  const handleSnapChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    store.getState().setSnapGrid(event.target.value as DurationName);
  };

  const handleQuantize = (): void => {
    if (!score) return;
    const ids = selectedNoteIds(score, store.getState().selection);
    commitQuantize(store, ids, {
      grid: ticksFor(snapGrid, score.ppq),
      quantizeStarts: true,
      quantizeDurations: true,
    });
  };

  const handleLoopFromSelection = (): void => loopFromSelection(store);

  const toggleTrack = (trackId: UUID): void => {
    const next = new Set(selectedTrackIds);
    if (next.has(trackId)) next.delete(trackId);
    else next.add(trackId);
    onVisibleTrackIdsChange(next.size === trackIds.length ? null : next);
  };

  const trackFilterLabel =
    selectedTrackIds.size === trackIds.length ? 'All tracks' : `${selectedTrackIds.size} track(s)`;

  return (
    <div
      role="toolbar"
      aria-label="Piano roll toolbar"
      className="flex flex-wrap items-center gap-1 border-b border-theme-border px-2 py-1"
    >
      <div className="flex items-center gap-0.5">
        <Tooltip content="Zoom horizontal out">
          <button
            type="button"
            aria-label="Zoom horizontal out"
            onClick={() => onZoomHChange(clampZoom(zoomH / ZOOM_STEP))}
            className={ICON_BUTTON_CLASS}
          >
            ↔−
          </button>
        </Tooltip>
        <span aria-label="Current horizontal zoom level" className="min-w-[40px] text-center text-sm text-theme-text-primary">
          {Math.round(zoomH * 100)}%
        </span>
        <Tooltip content="Zoom horizontal in">
          <button
            type="button"
            aria-label="Zoom horizontal in"
            onClick={() => onZoomHChange(clampZoom(zoomH * ZOOM_STEP))}
            className={ICON_BUTTON_CLASS}
          >
            ↔+
          </button>
        </Tooltip>
      </div>

      <div className="flex items-center gap-0.5">
        <Tooltip content="Zoom vertical out">
          <button
            type="button"
            aria-label="Zoom vertical out"
            onClick={() => onZoomVChange(clampZoom(zoomV / ZOOM_STEP))}
            className={ICON_BUTTON_CLASS}
          >
            ↕−
          </button>
        </Tooltip>
        <span aria-label="Current vertical zoom level" className="min-w-[40px] text-center text-sm text-theme-text-primary">
          {Math.round(zoomV * 100)}%
        </span>
        <Tooltip content="Zoom vertical in">
          <button
            type="button"
            aria-label="Zoom vertical in"
            onClick={() => onZoomVChange(clampZoom(zoomV * ZOOM_STEP))}
            className={ICON_BUTTON_CLASS}
          >
            ↕+
          </button>
        </Tooltip>
      </div>

      <VerticalDivider />

      <select aria-label="Snap grid" value={snapGrid} onChange={handleSnapChange} className={SELECT_CLASS}>
        {SNAP_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Quantize"
        disabled={!hasScore}
        onClick={handleQuantize}
        className={TEXT_BUTTON_CLASS}
      >
        Quantize
      </button>

      <VerticalDivider />

      <button
        type="button"
        aria-label="Loop selection"
        disabled={!hasScore}
        onClick={handleLoopFromSelection}
        className={TEXT_BUTTON_CLASS}
      >
        Loop selection
      </button>

      <div className="flex-1" />

      <div ref={trackFilterRef} className="relative">
        <button
          type="button"
          role="combobox"
          aria-label="Track filter"
          aria-haspopup="listbox"
          aria-expanded={trackFilterOpen}
          disabled={!hasScore}
          onClick={() => setTrackFilterOpen((open) => !open)}
          className={`${SELECT_CLASS} min-w-[140px] text-left disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {trackFilterLabel}
        </button>
        {trackFilterOpen ? (
          <div
            role="listbox"
            aria-label="Track filter"
            aria-multiselectable="true"
            className="absolute right-0 top-full z-10 mt-1 min-w-[180px] rounded-md border border-theme-border bg-theme-bg-secondary py-1 shadow-lg"
          >
            {(score?.tracks ?? []).map((track) => (
              <div
                key={track.id}
                role="option"
                aria-selected={selectedTrackIds.has(track.id)}
                onClick={() => toggleTrack(track.id)}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-theme-text-primary hover:bg-theme-hover-bg"
              >
                <input
                  type="checkbox"
                  aria-label={`Show track: ${track.name}`}
                  checked={selectedTrackIds.has(track.id)}
                  onChange={() => toggleTrack(track.id)}
                  onClick={(event) => event.stopPropagation()}
                  className="h-4 w-4"
                />
                <span>{track.name}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <VerticalDivider />

      <div role="group" aria-label="Editor view" className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Notation view"
          aria-pressed={view === 'notation'}
          onClick={() => store.getState().setView('notation')}
          className={TOGGLE_BUTTON_CLASS}
        >
          Notation
        </button>
        <button
          type="button"
          aria-label="Piano roll view"
          aria-pressed={view === 'piano-roll'}
          onClick={() => store.getState().setView('piano-roll')}
          className={TOGGLE_BUTTON_CLASS}
        >
          Piano roll
        </button>
      </div>
    </div>
  );
}
