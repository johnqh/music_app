/**
 * Piano-roll toolbar (spec §8): a collapse toggle for the panel,
 * independent horizontal/vertical zoom, snap-grid select (shared with the
 * notation view's `uiSlice.snapGrid`), quantize, and "loop selection".
 *
 * No view switch and no track filter any more: notation and the piano roll
 * are shown at the same time, and the roll always shows the active track
 * (`selectActiveTrackId`), so a manual filter would only fight that.
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
 * the library's Radix-backed `Select`.
 */
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from '@sudobility/components';
import type { DurationName } from '@sudobility/music_types';
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
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

const SNAP_OPTIONS: DurationName[] = [
  'whole',
  'half',
  'quarter',
  'eighth',
  'sixteenth',
  'thirtysecond',
];

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

const ICON_BUTTON_CLASS = 'h-auto w-auto p-1.5 text-sm leading-none';

const TEXT_BUTTON_CLASS = 'px-3 py-1.5';

function VerticalDivider() {
  return <div className="mx-1 h-6 w-px shrink-0 self-center bg-theme-border" aria-hidden="true" />;
}

export function PianoRollToolbar({
  store = useAppStore,
  zoomH,
  zoomV,
  onZoomHChange,
  onZoomVChange,
  collapsed,
  onToggleCollapsed,
}: PianoRollToolbarProps) {
  const score = store((s) => s.score);
  const snapGrid = store((s) => s.snapGrid);
  const hasScore = score !== null;

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

  return (
    <div
      role="toolbar"
      aria-label="Piano roll toolbar"
      className="flex flex-wrap items-center gap-1 border-b border-theme-border px-2 py-1"
    >
      {/* First child on purpose: when the panel is collapsed this strip is
          all that renders, so the expand control must never be one of the
          things that got collapsed away. */}
      <Tooltip content={collapsed ? 'Expand piano roll' : 'Collapse piano roll'}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={collapsed ? 'Expand piano roll' : 'Collapse piano roll'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
          className="h-auto w-auto p-1.5 text-sm leading-none"
        >
          {collapsed ? '▴' : '▾'}
        </Button>
      </Tooltip>

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
        <span
          aria-label="Current horizontal zoom level"
          className="min-w-[40px] text-center text-sm text-theme-text-primary"
        >
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
        <span
          aria-label="Current vertical zoom level"
          className="min-w-[40px] text-center text-sm text-theme-text-primary"
        >
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
        <SelectTrigger
          aria-label="Snap grid"
          className="h-auto w-auto min-w-[110px] px-2 py-1.5 text-sm"
        >
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

    </div>
  );
}
