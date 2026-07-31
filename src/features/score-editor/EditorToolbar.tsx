/**
 * Score editor toolbar (spec §6 editor region, §7 editing operations):
 * note-duration palette, accidental toggle, articulation menu, tie toggle,
 * insert note/rest, quantize button + grid select, zoom controls, layout
 * mode toggle.
 *
 * Every control that mutates the score routes through `editing.ts` (never
 * `store.dispatchCommand` directly), and every interactive control carries
 * an explicit `aria-label` (spec §27: ARIA labels, don't rely on
 * icon/color alone).
 *
 * Adopts `@sudobility/components` controls (library sweep 1): plain
 * buttons become the library `Button` (`aria-pressed`/`aria-label`/
 * `disabled` all just work, it forwards `ButtonHTMLAttributes`), and the
 * quantize-grid `<select>` becomes the library's Radix-backed `Select`.
 * The articulation menu stays a hand-built `role="menu"`/`role="menuitem"`
 * popover: neither `src/ui/dropdown.tsx` (its items are plain buttons with
 * no `menu`/`menuitem` roles at all) nor `src/ui/command.tsx` (a full
 * modal command-palette `Dialog`, wrong shape for a small inline popover)
 * reproduce those roles, so a library swap there would be a real semantics
 * change, not just a skin -- only the trigger/item buttons inside it move
 * to the library `Button`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  cn,
} from '@sudobility/components';
import { variants } from '@sudobility/design';
import { findEvent } from '@sudobility/music_lib';
import { isNoteEvent } from '@sudobility/music_types';
import type { Accidental, Articulation, DurationName, Pitch } from '@sudobility/music_types';
import { ticksFor } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import {
  changeAccidental,
  changeArticulation,
  changeDuration,
  insertNoteAtSelection,
  insertRestAtSelection,
  quantizeSelection,
  selectAll,
  toggleTie,
} from '@/features/score-editor/editing';

export type LayoutMode = 'page' | 'continuous';

export type EditorToolbarProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
  /** Inspector visibility. Omitted when the view is rendered without a surrounding layout, in which case no toggle shows. */
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
};

const DURATION_OPTIONS: Array<{ value: DurationName; label: string; ariaLabel: string }> = [
  { value: 'whole', label: '𝅝', ariaLabel: 'Whole note' },
  { value: 'half', label: '𝅗𝅥', ariaLabel: 'Half note' },
  { value: 'quarter', label: '♩', ariaLabel: 'Quarter note' },
  { value: 'eighth', label: '♪', ariaLabel: 'Eighth note' },
  { value: 'sixteenth', label: '𝅘𝅥𝅯', ariaLabel: 'Sixteenth note' },
  { value: 'thirtysecond', label: '𝅘𝅥𝅰', ariaLabel: 'Thirty-second note' },
];

const ACCIDENTAL_OPTIONS: Array<{ value: Accidental; label: string; ariaLabel: string }> = [
  { value: -2, label: '𝄫', ariaLabel: 'Double flat' },
  { value: -1, label: '♭', ariaLabel: 'Flat' },
  { value: 0, label: '♮', ariaLabel: 'Natural' },
  { value: 1, label: '♯', ariaLabel: 'Sharp' },
  { value: 2, label: '𝄪', ariaLabel: 'Double sharp' },
];

const ARTICULATION_OPTIONS: Array<{ value: Articulation | undefined; label: string }> = [
  { value: undefined, label: 'None' },
  { value: 'staccato', label: 'Staccato' },
  { value: 'accent', label: 'Accent' },
  { value: 'tenuto', label: 'Tenuto' },
  { value: 'marcato', label: 'Marcato' },
];

const QUANTIZE_GRID_OPTIONS: DurationName[] = ['quarter', 'eighth', 'sixteenth', 'thirtysecond'];

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The pitch a freshly-inserted note should use: the first selected note's own pitch, else middle C. */
function defaultInsertPitch(store: EditorStoreApi): Pitch {
  const { score, selection } = store.getState();
  if (score) {
    for (const id of selection.eventIds) {
      const event = findEvent(score, id);
      if (event && isNoteEvent(event)) return event.pitch;
    }
  }
  return { step: 'C', accidental: 0, octave: 4 };
}

const ICON_BUTTON_CLASS = 'h-auto w-auto p-1.5 text-sm leading-none';

const TOGGLE_BUTTON_CLASS = cn(
  'px-2 py-1 text-sm',
  'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90',
);

const TEXT_BUTTON_CLASS = 'px-3 py-1.5';

function VerticalDivider() {
  return <div className="mx-1 h-6 w-px shrink-0 self-center bg-theme-border" aria-hidden="true" />;
}

export function EditorToolbar({
  store = useAppStore,
  layoutMode,
  onLayoutModeChange,
  inspectorOpen,
  onToggleInspector,
}: EditorToolbarProps) {
  const score = store((s) => s.score);
  const snapGrid = store((s) => s.snapGrid);
  const zoom = store((s) => s.zoom);
  const hasScore = score !== null;

  const [quantizeGrid, setQuantizeGrid] = useState<DurationName>('sixteenth');
  const [articulationOpen, setArticulationOpen] = useState(false);
  const articulationRef = useRef<HTMLDivElement | null>(null);

  const zoomLabel = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom]);

  useEffect(() => {
    if (!articulationOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!articulationRef.current?.contains(event.target as Node)) setArticulationOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [articulationOpen]);

  const handleDurationClick = (value: DurationName): void => {
    store.getState().setSnapGrid(value);
    changeDuration(store, value);
  };

  const handleAccidentalClick = (accidental: Accidental): void => {
    changeAccidental(store, accidental);
  };

  const handleArticulationSelect = (articulation: Articulation | undefined): void => {
    changeArticulation(store, articulation);
    setArticulationOpen(false);
  };

  const handleInsertNote = (): void => {
    insertNoteAtSelection(store, defaultInsertPitch(store));
  };

  const handleInsertRest = (): void => {
    insertRestAtSelection(store);
  };

  const handleQuantizeGridChange = (value: string): void => {
    setQuantizeGrid(value as DurationName);
  };

  const handleQuantize = (): void => {
    if (!score) return;
    quantizeSelection(store, {
      grid: ticksFor(quantizeGrid, score.ppq),
      quantizeStarts: true,
      quantizeDurations: true,
    });
  };

  const handleZoomIn = (): void => store.getState().setZoom(clampZoom(zoom * ZOOM_STEP));
  const handleZoomOut = (): void => store.getState().setZoom(clampZoom(zoom / ZOOM_STEP));

  return (
    // Two parts on one row: the tools scroll, the inspector toggle does not.
    // The toggle sits outside the scrolling region because inside it the
    // `flex-1` spacer collapses once the tools overflow, pushing the toggle
    // past the right edge where it can only be reached by scrolling the
    // toolbar.
    <div className="flex shrink-0 items-stretch border-b border-theme-border">
      <div
        role="toolbar"
        aria-label="Score editor toolbar"
        // `flex-nowrap` + horizontal scroll, NOT `flex-wrap`: this app is bounded
        // to the viewport, and a wrapping toolbar grows without limit as the
        // window narrows. At 800px it reached 475px tall, overflowed the app
        // root and made the whole document scrollable, which showed up as the
        // page sliding away with blank space under the keyboard panel.
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1"
      >
      <div role="group" aria-label="Note duration" className="flex items-center gap-0.5">
        {DURATION_OPTIONS.map((option) => (
          <Tooltip key={option.value} content={option.ariaLabel}>
            <Button
              type="button"
              variant="ghost"
              aria-label={option.ariaLabel}
              aria-pressed={snapGrid === option.value}
              onClick={() => handleDurationClick(option.value)}
              className={TOGGLE_BUTTON_CLASS}
            >
              {option.label}
            </Button>
          </Tooltip>
        ))}
      </div>

      <VerticalDivider />

      <div role="group" aria-label="Accidental" className="flex items-center gap-0.5">
        {ACCIDENTAL_OPTIONS.map((option) => (
          <Tooltip key={option.value} content={option.ariaLabel}>
            <Button
              type="button"
              variant="ghost"
              aria-label={option.ariaLabel}
              disabled={!hasScore}
              onClick={() => handleAccidentalClick(option.value)}
              className={ICON_BUTTON_CLASS}
            >
              {option.label}
            </Button>
          </Tooltip>
        ))}
      </div>

      <VerticalDivider />

      <div ref={articulationRef} className="relative">
        <Tooltip content="Add an articulation to the selection">
          <Button
            type="button"
            variant="outline"
            aria-label="Articulation"
            aria-haspopup="menu"
            aria-expanded={articulationOpen}
            disabled={!hasScore}
            onClick={() => setArticulationOpen((open) => !open)}
            className={TEXT_BUTTON_CLASS}
          >
            Articulation
          </Button>
        </Tooltip>
        {articulationOpen ? (
          <div
            role="menu"
            className={cn(
              variants.card.default.base(),
              'absolute left-0 top-full z-10 mt-1 min-w-[140px] rounded-md py-1 shadow-lg',
            )}
          >
            {ARTICULATION_OPTIONS.map((option) => (
              <Button
                key={option.label}
                type="button"
                variant="ghost"
                role="menuitem"
                onClick={() => handleArticulationSelect(option.value)}
                className="block w-full justify-start rounded-none px-3 py-1.5 text-left"
              >
                {option.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <Tooltip content="Toggle tie">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Toggle tie"
          disabled={!hasScore}
          onClick={() => toggleTie(store, 'tieStart')}
          className={ICON_BUTTON_CLASS}
        >
          ⌣
        </Button>
      </Tooltip>

      <VerticalDivider />

      <Tooltip content="Insert a note at the caret">
        <Button
          type="button"
          variant="outline"
          aria-label="Insert note"
          disabled={!hasScore}
          onClick={handleInsertNote}
          className={TEXT_BUTTON_CLASS}
        >
          Insert note
        </Button>
      </Tooltip>
      <Tooltip content="Insert a rest at the caret">
        <Button
          type="button"
          variant="outline"
          aria-label="Insert rest"
          disabled={!hasScore}
          onClick={handleInsertRest}
          className={TEXT_BUTTON_CLASS}
        >
          Insert rest
        </Button>
      </Tooltip>
      <Tooltip content="Select every note in the score">
        <Button
          type="button"
          variant="outline"
          aria-label="Select all"
          disabled={!hasScore}
          onClick={() => selectAll(store)}
          className={TEXT_BUTTON_CLASS}
        >
          Select all
        </Button>
      </Tooltip>

      <VerticalDivider />

      <Tooltip content="Grid that Quantize snaps to">
        <Select value={quantizeGrid} onValueChange={handleQuantizeGridChange}>
          <SelectTrigger
            aria-label="Quantize grid"
            className="h-auto w-auto min-w-[110px] px-2 py-1.5 text-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUANTIZE_GRID_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Tooltip>
      <Tooltip content="Snap the selection to the quantize grid">
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
      </Tooltip>

      <VerticalDivider />

      <div className="flex items-center gap-0.5">
        <Tooltip content="Zoom out">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Zoom out"
            onClick={handleZoomOut}
            className={ICON_BUTTON_CLASS}
          >
            −
          </Button>
        </Tooltip>
        <Tooltip content="Current zoom level">
          <span
            aria-label="Current zoom level"
            className="min-w-[40px] text-center text-sm text-theme-text-primary"
          >
            {zoomLabel}
          </span>
        </Tooltip>
        <Tooltip content="Zoom in">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Zoom in"
            onClick={handleZoomIn}
            className={ICON_BUTTON_CLASS}
          >
            +
          </Button>
        </Tooltip>
      </div>

      <VerticalDivider />

      <div role="group" aria-label="Layout mode" className="flex items-center gap-0.5">
        <Tooltip content="Wrap systems to the page width">
          <Button
            type="button"
            variant="ghost"
            aria-label="Page layout"
            aria-pressed={layoutMode === 'page'}
            onClick={() => onLayoutModeChange('page')}
            className={TOGGLE_BUTTON_CLASS}
          >
            Page
          </Button>
        </Tooltip>
        <Tooltip content="Lay the score out in one scrolling line">
          <Button
            type="button"
            variant="ghost"
            aria-label="Continuous layout"
            aria-pressed={layoutMode === 'continuous'}
            onClick={() => onLayoutModeChange('continuous')}
            className={TOGGLE_BUTTON_CLASS}
          >
            Continuous
          </Button>
        </Tooltip>
      </div>

      </div>

      {/* Outside the scroller, so it stays reachable however narrow the window
          gets. It controls the inspector, not the score, which is why it sits
          apart from the tools rather than among them. */}
      {onToggleInspector && (
        <div className="flex shrink-0 items-center pr-1">
          <Tooltip content={inspectorOpen ? 'Hide inspector' : 'Show inspector'}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Toggle inspector panel"
              onClick={onToggleInspector}
              className="h-auto w-auto p-1.5 text-sm leading-none"
            >
              {inspectorOpen ? '⟩' : '⟨'}
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
