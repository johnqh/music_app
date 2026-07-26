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
 * Adopts `@sudobility/components` controls (library sweep 1): plain
 * buttons become the library `Button`, and the snap-grid `<select>` becomes
 * the library's Radix-backed `Select`. The per-track visibility filter
 * stays a hand-built `role="combobox"` trigger + `role="listbox"`/
 * `role="option"` popover: `src/ui/multi-select.tsx`'s trigger is a plain
 * button with no `combobox` role and its options carry no `option` role
 * either, so swapping to it would drop the very roles this toolbar's own
 * tests assert on -- a real semantics loss, not a skin. The checkbox in
 * each option does move to the library `Checkbox`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tooltip, cn } from '@sudobility/components';
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

const ICON_BUTTON_CLASS = 'h-auto w-auto p-1.5 text-sm leading-none';

const TOGGLE_BUTTON_CLASS = cn('px-2 py-1 text-sm', 'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90');

const TEXT_BUTTON_CLASS = 'px-3 py-1.5';

const COMBOBOX_TRIGGER_CLASS =
  'flex h-9 min-w-[140px] items-center rounded-md border border-theme-border bg-theme-bg-primary px-2 py-1.5 text-left text-sm text-theme-text-primary disabled:cursor-not-allowed disabled:opacity-40';

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

  const handleSnapChange = (value: string): void => {
    store.getState().setSnapGrid(value as DurationName);
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Zoom horizontal out"
            onClick={() => onZoomHChange(clampZoom(zoomH / ZOOM_STEP))}
            className={ICON_BUTTON_CLASS}
          >
            ↔−
          </Button>
        </Tooltip>
        <span aria-label="Current horizontal zoom level" className="min-w-[40px] text-center text-sm text-theme-text-primary">
          {Math.round(zoomH * 100)}%
        </span>
        <Tooltip content="Zoom horizontal in">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Zoom horizontal in"
            onClick={() => onZoomHChange(clampZoom(zoomH * ZOOM_STEP))}
            className={ICON_BUTTON_CLASS}
          >
            ↔+
          </Button>
        </Tooltip>
      </div>

      <div className="flex items-center gap-0.5">
        <Tooltip content="Zoom vertical out">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Zoom vertical out"
            onClick={() => onZoomVChange(clampZoom(zoomV / ZOOM_STEP))}
            className={ICON_BUTTON_CLASS}
          >
            ↕−
          </Button>
        </Tooltip>
        <span aria-label="Current vertical zoom level" className="min-w-[40px] text-center text-sm text-theme-text-primary">
          {Math.round(zoomV * 100)}%
        </span>
        <Tooltip content="Zoom vertical in">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Zoom vertical in"
            onClick={() => onZoomVChange(clampZoom(zoomV * ZOOM_STEP))}
            className={ICON_BUTTON_CLASS}
          >
            ↕+
          </Button>
        </Tooltip>
      </div>

      <VerticalDivider />

      <Select value={snapGrid} onValueChange={handleSnapChange}>
        <SelectTrigger aria-label="Snap grid" className="h-auto w-auto min-w-[110px] px-2 py-1.5 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SNAP_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        aria-label="Quantize"
        disabled={!hasScore}
        onClick={handleQuantize}
        className={TEXT_BUTTON_CLASS}
      >
        Quantize
      </Button>

      <VerticalDivider />

      <Button
        type="button"
        variant="outline"
        aria-label="Loop selection"
        disabled={!hasScore}
        onClick={handleLoopFromSelection}
        className={TEXT_BUTTON_CLASS}
      >
        Loop selection
      </Button>

      <div className="flex-1" />

      <div ref={trackFilterRef} className="relative">
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label="Track filter"
          aria-haspopup="listbox"
          aria-expanded={trackFilterOpen}
          disabled={!hasScore}
          onClick={() => setTrackFilterOpen((open) => !open)}
          className={COMBOBOX_TRIGGER_CLASS}
        >
          {trackFilterLabel}
        </Button>
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
                {/* Stops the click here (rather than on the Checkbox itself,
                    which -- unlike the plain native <input> this replaces --
                    accepts no onClick of its own to call stopPropagation
                    from) so toggling the checkbox doesn't *also* bubble up
                    to this row's own onClick and double-toggle the track. */}
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    id={`track-filter-${track.id}`}
                    size="sm"
                    checked={selectedTrackIds.has(track.id)}
                    onChange={() => toggleTrack(track.id)}
                  />
                </div>
                {/* The Checkbox component has no aria-label prop of its own
                    (a closed CheckboxProps, no HTML-attribute passthrough),
                    so the same accessible name it used to get from a direct
                    `aria-label` is supplied via an external <label for>
                    pointing at the Checkbox's own forwarded `id` -- visually
                    hidden since the visible track name is already shown by
                    the sibling <span> below. */}
                <label htmlFor={`track-filter-${track.id}`} className="sr-only">
                  {`Show track: ${track.name}`}
                </label>
                <span>{track.name}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <VerticalDivider />

      <div role="group" aria-label="Editor view" className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          aria-label="Notation view"
          aria-pressed={view === 'notation'}
          onClick={() => store.getState().setView('notation')}
          className={TOGGLE_BUTTON_CLASS}
        >
          Notation
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label="Piano roll view"
          aria-pressed={view === 'piano-roll'}
          onClick={() => store.getState().setView('piano-roll')}
          className={TOGGLE_BUTTON_CLASS}
        >
          Piano roll
        </Button>
      </div>
    </div>
  );
}
