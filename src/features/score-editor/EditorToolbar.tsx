/**
 * Score editor toolbar (spec §6 editor region, §7 editing operations):
 * note-duration palette, accidental toggle, articulation menu, tie toggle,
 * insert note/rest, quantize button + grid select, zoom controls, layout
 * mode toggle, and the notation/piano-roll view switch.
 *
 * Every control that mutates the score routes through `editing.ts` (never
 * `store.dispatchCommand` directly), and every interactive control carries
 * an explicit `aria-label` (spec §27: ARIA labels, don't rely on
 * icon/color alone).
 *
 * Re-skinned onto Tailwind + @sudobility/components (T12 batch 2): MUI
 * ToggleButton(Group)s become plain buttons with `aria-pressed`, the MUI
 * Select becomes a native `<select>`, and the MUI Menu becomes a small
 * `role="menu"`/`role="menuitem"` popover built from plain buttons — same
 * roles/accessible names as before, so no test assertions changed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Tooltip, cn } from '@sudobility/components';
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

const ICON_BUTTON_CLASS = cn(variants.button.ghost.icon(), 'h-auto w-auto p-1.5 text-sm leading-none');

const TOGGLE_BUTTON_CLASS = cn(
  variants.button.ghost.default(),
  'px-2 py-1 text-sm',
  'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90',
);

const TEXT_BUTTON_CLASS = cn(variants.button.outline.default(), 'px-3 py-1.5');

const SELECT_CLASS = 'rounded-md border border-theme-border bg-theme-bg-primary px-2 py-1.5 text-sm text-theme-text-primary';

function VerticalDivider() {
  return <div className="mx-1 h-6 w-px shrink-0 self-center bg-theme-border" aria-hidden="true" />;
}

export function EditorToolbar({ store = useAppStore, layoutMode, onLayoutModeChange }: EditorToolbarProps) {
  const score = store((s) => s.score);
  const snapGrid = store((s) => s.snapGrid);
  const view = store((s) => s.view);
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

  const handleQuantizeGridChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setQuantizeGrid(event.target.value as DurationName);
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
    <div
      role="toolbar"
      aria-label="Score editor toolbar"
      className="flex flex-wrap items-center gap-1 border-b border-theme-border px-2 py-1"
    >
      <div role="group" aria-label="Note duration" className="flex items-center gap-0.5">
        {DURATION_OPTIONS.map((option) => (
          <Tooltip key={option.value} content={option.ariaLabel}>
            <button
              type="button"
              aria-label={option.ariaLabel}
              aria-pressed={snapGrid === option.value}
              onClick={() => handleDurationClick(option.value)}
              className={TOGGLE_BUTTON_CLASS}
            >
              {option.label}
            </button>
          </Tooltip>
        ))}
      </div>

      <VerticalDivider />

      <div role="group" aria-label="Accidental" className="flex items-center gap-0.5">
        {ACCIDENTAL_OPTIONS.map((option) => (
          <Tooltip key={option.value} content={option.ariaLabel}>
            <button
              type="button"
              aria-label={option.ariaLabel}
              disabled={!hasScore}
              onClick={() => handleAccidentalClick(option.value)}
              className={ICON_BUTTON_CLASS}
            >
              {option.label}
            </button>
          </Tooltip>
        ))}
      </div>

      <VerticalDivider />

      <div ref={articulationRef} className="relative">
        <button
          type="button"
          aria-label="Articulation"
          aria-haspopup="menu"
          aria-expanded={articulationOpen}
          disabled={!hasScore}
          onClick={() => setArticulationOpen((open) => !open)}
          className={TEXT_BUTTON_CLASS}
        >
          Articulation
        </button>
        {articulationOpen ? (
          <div
            role="menu"
            className={cn(
              variants.card.default.base(),
              'absolute left-0 top-full z-10 mt-1 min-w-[140px] rounded-md py-1 shadow-lg',
            )}
          >
            {ARTICULATION_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                role="menuitem"
                onClick={() => handleArticulationSelect(option.value)}
                className={cn(variants.button.ghost.default(), 'block w-full justify-start rounded-none px-3 py-1.5 text-left')}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Tooltip content="Toggle tie">
        <button
          type="button"
          aria-label="Toggle tie"
          disabled={!hasScore}
          onClick={() => toggleTie(store, 'tieStart')}
          className={ICON_BUTTON_CLASS}
        >
          ⌣
        </button>
      </Tooltip>

      <VerticalDivider />

      <button
        type="button"
        aria-label="Insert note"
        disabled={!hasScore}
        onClick={handleInsertNote}
        className={TEXT_BUTTON_CLASS}
      >
        Insert note
      </button>
      <button
        type="button"
        aria-label="Insert rest"
        disabled={!hasScore}
        onClick={handleInsertRest}
        className={TEXT_BUTTON_CLASS}
      >
        Insert rest
      </button>
      <button
        type="button"
        aria-label="Select all"
        disabled={!hasScore}
        onClick={() => selectAll(store)}
        className={TEXT_BUTTON_CLASS}
      >
        Select all
      </button>

      <VerticalDivider />

      <select aria-label="Quantize grid" value={quantizeGrid} onChange={handleQuantizeGridChange} className={SELECT_CLASS}>
        {QUANTIZE_GRID_OPTIONS.map((option) => (
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

      <div className="flex items-center gap-0.5">
        <Tooltip content="Zoom out">
          <button type="button" aria-label="Zoom out" onClick={handleZoomOut} className={ICON_BUTTON_CLASS}>
            −
          </button>
        </Tooltip>
        <span aria-label="Current zoom level" className="min-w-[40px] text-center text-sm text-theme-text-primary">
          {zoomLabel}
        </span>
        <Tooltip content="Zoom in">
          <button type="button" aria-label="Zoom in" onClick={handleZoomIn} className={ICON_BUTTON_CLASS}>
            +
          </button>
        </Tooltip>
      </div>

      <VerticalDivider />

      <div role="group" aria-label="Layout mode" className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Page layout"
          aria-pressed={layoutMode === 'page'}
          onClick={() => onLayoutModeChange('page')}
          className={TOGGLE_BUTTON_CLASS}
        >
          Page
        </button>
        <button
          type="button"
          aria-label="Continuous layout"
          aria-pressed={layoutMode === 'continuous'}
          onClick={() => onLayoutModeChange('continuous')}
          className={TOGGLE_BUTTON_CLASS}
        >
          Continuous
        </button>
      </div>

      <div className="flex-1" />

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
