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
  Tooltip,
  cn,
} from '@sudobility/components';
import { findEvent } from '@sudobility/music_lib';
import { isNoteEvent } from '@sudobility/music_types';
import type { Accidental, Articulation, DurationName, Pitch } from '@sudobility/music_types';
import { ticksFor } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import {
  addTrackCommand,
  createId,
  gmMaxPolyphony,
  selectActiveTrackId,
} from '@sudobility/music_lib';
import type { EditMode } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { durationParts, withBase, withModifier } from '@/features/score-editor/duration-modifiers';
import type { BaseDuration } from '@/features/score-editor/duration-modifiers';
import { TrackVisibilitySelect } from '@/features/score-editor/TrackVisibilitySelect';
import { dispatchTracked } from '@/features/score-editor/editing';
import type { ReactElement } from 'react';
import {
  ClipboardIcon,
  EllipsisHorizontalIcon,
  DocumentDuplicateIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  ScissorsIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import {
  DoubleFlatIcon,
  DoubleSharpIcon,
  EighthNoteIcon,
  FlatIcon,
  HalfNoteIcon,
  NaturalIcon,
  QuarterNoteIcon,
  SharpIcon,
  SixteenthNoteIcon,
  ICON_GLYPH_CLASS,
  ArticulationIcon,
  ChordIcon,
  DottedIcon,
  TripletIcon,
  InsertModeIcon,
  ReplaceModeIcon,
  ContinuousLayoutIcon,
  InsertNoteIcon,
  InsertRestIcon,
  PageLayoutIcon,
  QuantizeIcon,
  ThirtySecondNoteIcon,
  TieIcon,
  WholeNoteIcon,
} from '@/components/icons/notation-icons';
import {
  addMeasure,
  deleteMeasureAtCaret,
  deleteSelected,
  changeAccidental,
  changeArticulation,
  changeDuration,
  insertNoteAtCaret,
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
  /** Opens the generate-track modal. Omitted when no host provides one. */
  onGenerateTrack?: () => void;
  /**
   * Cut and paste go through the view's prompt hook rather than the store, so
   * the button and the keyboard shortcut ask the same question. Optional so
   * the toolbar still renders standalone in a test.
   */
  onCut?: () => void;
  onPaste?: () => void;
};

/**
 * Drawn icons, not Unicode musical symbols: the note glyphs live in Unicode's
 * Supplementary Multilingual Plane, which most UI fonts do not cover, so they
 * rendered as tofu on a plain system — and the two that were widely available
 * (`♩`, `♪`) came from a different block and never matched the others' size.
 */
const DURATION_OPTIONS: Array<{ value: BaseDuration; Icon: NotationIcon; ariaLabel: string }> = [
  { value: 'whole', Icon: WholeNoteIcon, ariaLabel: 'Whole note' },
  { value: 'half', Icon: HalfNoteIcon, ariaLabel: 'Half note' },
  { value: 'quarter', Icon: QuarterNoteIcon, ariaLabel: 'Quarter note' },
  { value: 'eighth', Icon: EighthNoteIcon, ariaLabel: 'Eighth note' },
  { value: 'sixteenth', Icon: SixteenthNoteIcon, ariaLabel: 'Sixteenth note' },
  { value: 'thirtysecond', Icon: ThirtySecondNoteIcon, ariaLabel: 'Thirty-second note' },
];

const ACCIDENTAL_OPTIONS: Array<{ value: Accidental; Icon: NotationIcon; ariaLabel: string }> = [
  { value: -2, Icon: DoubleFlatIcon, ariaLabel: 'Double flat' },
  { value: -1, Icon: FlatIcon, ariaLabel: 'Flat' },
  { value: 0, Icon: NaturalIcon, ariaLabel: 'Natural' },
  { value: 1, Icon: SharpIcon, ariaLabel: 'Sharp' },
  { value: 2, Icon: DoubleSharpIcon, ariaLabel: 'Double sharp' },
];

/** Radix rejects an empty item value, so "None" travels under a sentinel. */
const NO_ARTICULATION = 'none';

const ARTICULATION_OPTIONS: Array<{ value: Articulation | undefined; label: string }> = [
  { value: undefined, label: 'None' },
  { value: 'staccato', label: 'Staccato' },
  { value: 'accent', label: 'Accent' },
  { value: 'tenuto', label: 'Tenuto' },
  { value: 'marcato', label: 'Marcato' },
];

/**
 * Quantize grid values, with the short label the trigger shows.
 *
 * "1/16" rather than "thirtysecond": the full words made this the widest
 * control on the bar, for a setting that is read at a glance and changed
 * rarely. The menu still spells them out.
 */
const QUANTIZE_GRID_OPTIONS: Array<{ value: DurationName; short: string; label: string }> = [
  { value: 'quarter', short: '1/4', label: 'Quarter' },
  { value: 'eighth', short: '1/8', label: 'Eighth' },
  { value: 'sixteenth', short: '1/16', label: 'Sixteenth' },
  { value: 'thirtysecond', short: '1/32', label: 'Thirty-second' },
];

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

/** A drawn notation glyph: sized by the caller, coloured by `currentColor`. */
type NotationIcon = (props: { className?: string }) => ReactElement;

const ICON_BUTTON_CLASS = 'h-auto w-auto p-1.5 text-sm leading-none';

const TOGGLE_BUTTON_CLASS = cn(
  'px-2 py-1 text-sm',
  'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90',
);

function VerticalDivider() {
  return <div className="mx-1 h-6 w-px shrink-0 self-center bg-theme-border" aria-hidden="true" />;
}

export function EditorToolbar({
  store = useAppStore,
  layoutMode,
  onLayoutModeChange,
  inspectorOpen,
  onToggleInspector,
  onCut,
  onPaste,
  onGenerateTrack,
}: EditorToolbarProps) {
  const score = store((s) => s.score);
  const snapGrid = store((s) => s.snapGrid);
  const editMode = store((s) => s.editMode);
  const pitchDisplay = store((s) => s.pitchDisplay);
  const activeVoiceIndex = store((s) => s.activeVoiceIndex);
  const activeTrackId = store(selectActiveTrackId);
  const activeTrack = score?.tracks.find((t) => t.id === activeTrackId) ?? null;
  const canStack = gmMaxPolyphony(activeTrack?.midiProgram ?? 0) > 1;

  // A mode chosen before the track changed would otherwise refuse every edit,
  // and that refusal only surfaces after you have already played something.
  useEffect(() => {
    if (editMode === 'stack' && !canStack) store.getState().setEditMode('replace');
  }, [editMode, canStack, store]);

  const editModeOptions: Array<{
    value: EditMode;
    Icon: NotationIcon;
    label: string;
    hint: string;
  }> = [
    {
      value: 'insert',
      Icon: InsertModeIcon,
      label: 'Insert mode',
      hint: "Insert: notes you add push this track's later notes out of the way",
    },
    {
      value: 'replace',
      Icon: ReplaceModeIcon,
      label: 'Replace mode',
      hint: 'Replace: notes you add overwrite what was already there',
    },
    {
      value: 'stack',
      Icon: ChordIcon,
      label: 'Stack mode',
      hint: canStack
        ? 'Stack: notes you add join what is already there, building a chord'
        : `Stack needs an instrument that can play more than one note at a time — ${activeTrack?.instrumentName ?? 'this one'} cannot`,
    },
  ];
  const zoom = store((s) => s.zoom);
  const hasScore = score !== null;

  /**
   * Whether anything is selected.
   *
   * Eleven controls here act on the selection and quietly return when it is
   * empty — accidentals, articulation, tie, quantize, delete, copy, cut. They
   * were all merely `!hasScore`, so with a score open they looked available
   * and did nothing when clicked. A control that invites a click and gives no
   * feedback is worse than one that is plainly unavailable.
   */
  const selection = store((s) => s.selection);
  const hasSelection = selection.eventIds.length > 0 || selection.measureIds.length > 0;

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

  const handleMoreAction = (value: string): void => {
    if (value === 'select-all') selectAll(store);
    else if (value === 'add-measure') addMeasure(store);
    else if (value === 'delete-measure') deleteMeasureAtCaret(store);
  };

  const handleAccidentalSelect = (value: string): void => {
    changeAccidental(store, Number(value) as Accidental);
  };

  const handleArticulationSelect = (value: string): void => {
    changeArticulation(store, value === NO_ARTICULATION ? undefined : (value as Articulation));
  };

  const handleInsertNote = (): void => {
    insertNoteAtCaret(store, defaultInsertPitch(store));
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
        {/* Tracks first: which track you are on decides where every other
            control in this bar acts, so it reads left-to-right as "this track,
            then what to do to it". */}
        <div role="group" aria-label="Tracks" className="flex items-center gap-0.5">
          <TrackVisibilitySelect store={store} />
          <Select
            value=""
            onValueChange={(value) => {
              if (value === 'blank') {
                const id = createId();
                dispatchTracked(store, addTrackCommand({ id, name: 'New track' }));
                // Active immediately: you added it to work on it.
                store.getState().setActiveTrack(id);
              } else if (value === 'generate') {
                onGenerateTrack?.();
              }
            }}
          >
            <Tooltip placement="bottom" content="Add Track">
              <SelectTrigger
                aria-label="Add Track"
                disabled={!score}
                className="h-auto w-auto px-2 py-1"
              >
                <span>+</span>
              </SelectTrigger>
            </Tooltip>
            <SelectContent>
              <SelectItem value="blank">Blank Track</SelectItem>
              <SelectItem value="generate">Generate Track</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <VerticalDivider />

        {/* One click does two things -- arms the length for the next note AND
          retypes the selection -- and the pressed state only ever showed the
          first. The tooltip has to say both, or the second looks like the
          editor changing notes you did not ask it to. */}
        <div role="group" aria-label="Note duration" className="flex items-center gap-0.5">
          {DURATION_OPTIONS.map((option) => (
            <Tooltip
              placement="bottom"
              key={option.value}
              content={`${option.ariaLabel} — sets the length for notes you add, and changes any selected notes to it`}
            >
              <Button
                type="button"
                variant="ghost"
                aria-label={option.ariaLabel}
                aria-pressed={durationParts(snapGrid).base === option.value}
                onClick={() => handleDurationClick(withBase(snapGrid, option.value))}
                className={TOGGLE_BUTTON_CLASS}
              >
                <option.Icon className={ICON_GLYPH_CLASS} />
              </Button>
            </Tooltip>
          ))}
        </div>

        <div role="group" aria-label="Duration modifier" className="flex items-center gap-0.5">
          <Tooltip
            placement="bottom"
            content="Dotted — half again as long (a dotted quarter lasts three eighths)"
          >
            <Button
              type="button"
              variant="ghost"
              aria-label="Dotted"
              aria-pressed={durationParts(snapGrid).modifier === 'dotted'}
              disabled={!hasScore}
              onClick={() => handleDurationClick(withModifier(snapGrid, 'dotted'))}
              className={TOGGLE_BUTTON_CLASS}
            >
              <DottedIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
          <Tooltip
            placement="bottom"
            content="Triplet — three in the space of two (a triplet quarter lasts two thirds)"
          >
            <Button
              type="button"
              variant="ghost"
              aria-label="Triplet"
              aria-pressed={durationParts(snapGrid).modifier === 'triplet'}
              disabled={!hasScore}
              onClick={() => handleDurationClick(withModifier(snapGrid, 'triplet'))}
              className={TOGGLE_BUTTON_CLASS}
            >
              <TripletIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
        </div>

        <VerticalDivider />

        {/* One picker, not five buttons. Accidentals only ever act on a
          selection, so they are not something you reach for constantly while
          entering notes — and five near-identical glyphs were a quarter of the
          bar's width for an occasional edit. */}
        <Select value="" onValueChange={handleAccidentalSelect}>
          <Tooltip placement="bottom" content="Set the accidental on the selected notes">
            <SelectTrigger
              aria-label="Accidental"
              disabled={!hasScore || !hasSelection}
              className="h-auto w-auto gap-1 px-2 py-1.5"
            >
              <SharpIcon className={ICON_GLYPH_CLASS} />
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            {ACCIDENTAL_OPTIONS.map((option) => (
              <SelectItem key={option.ariaLabel} value={String(option.value)}>
                {option.ariaLabel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <VerticalDivider />

        {/*
        A Select, not a hand-rolled popup. The old menu was an absolutely
        positioned child of this toolbar, and the toolbar scrolls horizontally
        -- CSS stops the y axis being visible as soon as overflow-x is set, so
        the menu was clipped to the bar's height and its items could not be
        seen at all. Select portals its content out, which fixes that
        structurally rather than by fighting the overflow.

        `value` is deliberately never set: this applies an articulation to the
        selection, it does not hold one. The trigger shows a fixed icon.
      */}
        <Select value="" onValueChange={handleArticulationSelect}>
          <Tooltip placement="bottom" content="Add an articulation to the selection">
            <SelectTrigger
              aria-label="Articulation"
              disabled={!hasScore || !hasSelection}
              className={cn(ICON_BUTTON_CLASS, 'gap-1 [&_svg]:size-[18px]')}
            >
              <ArticulationIcon className={ICON_GLYPH_CLASS} />
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            {ARTICULATION_OPTIONS.map((option) => (
              <SelectItem key={option.label} value={option.value ?? NO_ARTICULATION}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tooltip placement="bottom" content="Toggle tie">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Toggle tie"
            disabled={!hasScore || !hasSelection}
            onClick={() => toggleTie(store, 'tieStart')}
            className={ICON_BUTTON_CLASS}
          >
            <TieIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        <VerticalDivider />

        <div role="group" aria-label="Edit mode" className="flex items-center gap-0.5">
          {editModeOptions.map((option) => (
            <Tooltip placement="bottom" key={option.value} content={option.hint}>
              <Button
                type="button"
                variant="ghost"
                aria-label={option.label}
                aria-pressed={editMode === option.value}
                disabled={!hasScore || (option.value === 'stack' && !canStack)}
                onClick={() => store.getState().setEditMode(option.value)}
                className={TOGGLE_BUTTON_CLASS}
              >
                <option.Icon className={ICON_GLYPH_CLASS} />
              </Button>
            </Tooltip>
          ))}
        </div>
        <Tooltip placement="bottom" content="Insert a note at the caret">
          <Button
            type="button"
            variant="outline"
            aria-label="Insert note"
            disabled={!hasScore}
            onClick={handleInsertNote}
            className={ICON_BUTTON_CLASS}
          >
            <InsertNoteIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>
        <Tooltip placement="bottom" content="Insert a rest at the caret">
          <Button
            type="button"
            variant="outline"
            aria-label="Insert rest"
            disabled={!hasScore}
            onClick={handleInsertRest}
            className={ICON_BUTTON_CLASS}
          >
            <InsertRestIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>
        <div role="group" aria-label="Clipboard" className="flex items-center gap-0.5">
          <Tooltip placement="bottom" content="Copy the selected notes (Ctrl/Cmd+C)">
            <Button
              type="button"
              variant="outline"
              aria-label="Copy"
              disabled={!hasScore || !hasSelection}
              onClick={() => store.getState().copySelection()}
              className={ICON_BUTTON_CLASS}
            >
              <DocumentDuplicateIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
          <Tooltip placement="bottom" content="Cut the selected notes (Ctrl/Cmd+X)">
            <Button
              type="button"
              variant="outline"
              aria-label="Cut"
              disabled={!hasScore || !hasSelection}
              onClick={onCut}
              className={ICON_BUTTON_CLASS}
            >
              <ScissorsIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
          <Tooltip placement="bottom" content="Paste at the caret (Ctrl/Cmd+V)">
            <Button
              type="button"
              variant="outline"
              aria-label="Paste"
              disabled={!hasScore}
              onClick={onPaste}
              className={ICON_BUTTON_CLASS}
            >
              <ClipboardIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
        </div>

        <Tooltip placement="bottom" content="Delete the selected notes (Delete)">
          <Button
            type="button"
            variant="outline"
            aria-label="Delete selection"
            disabled={!hasScore || !hasSelection}
            onClick={() => deleteSelected(store)}
            className={ICON_BUTTON_CLASS}
          >
            <TrashIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        <VerticalDivider />

        <Tooltip placement="bottom" content="Grid that Quantize snaps to">
          <Select value={quantizeGrid} onValueChange={handleQuantizeGridChange}>
            <SelectTrigger
              aria-label="Quantize grid"
              // The trigger's own chevron is 16px by default; this brings it in
              // line with every other icon on the bar.
              className="h-auto w-auto px-2 py-1.5 text-sm [&_svg]:size-[18px]"
            >
              {/* The short form, not `SelectValue`: the trigger is read at a
                glance and was the widest control on the bar. */}
              <span>
                {QUANTIZE_GRID_OPTIONS.find((option) => option.value === quantizeGrid)?.short ??
                  quantizeGrid}
              </span>
            </SelectTrigger>
            <SelectContent>
              {QUANTIZE_GRID_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Tooltip>
        <Tooltip placement="bottom" content="Snap the selection to the quantize grid">
          <Button
            type="button"
            variant="outline"
            aria-label="Quantize"
            disabled={!hasScore || !hasSelection}
            onClick={handleQuantize}
            className={ICON_BUTTON_CLASS}
          >
            <QuantizeIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        <VerticalDivider />

        <VerticalDivider />

        {/* Two voices is where the notation actually needs them — stems up
          against stems down on one stave. More than two is real notation too,
          but nothing else in the editor distinguishes voices yet, so offering
          four would be offering somewhere to lose notes. */}
        <div role="group" aria-label="Voice" className="flex items-center gap-0.5">
          {[0, 1].map((index) => (
            <Tooltip
              placement="bottom"
              key={index}
              content={
                index === 0
                  ? 'Voice 1 — the main line on this stave'
                  : 'Voice 2 — a second, independent line on the same stave'
              }
            >
              <Button
                type="button"
                variant="ghost"
                aria-label={`Voice ${index + 1}`}
                aria-pressed={activeVoiceIndex === index}
                disabled={!hasScore}
                onClick={() => store.getState().setActiveVoice(index)}
                className={TOGGLE_BUTTON_CLASS}
              >
                {index + 1}
              </Button>
            </Tooltip>
          ))}
        </div>

        <VerticalDivider />

        {/* The rare ones live behind a menu: each is a real action, but none is
          reached often enough to be worth permanent width on a bar that was
          already overflowing by 267px at 1440. */}
        <Select value="" onValueChange={handleMoreAction}>
          <Tooltip placement="bottom" content="More actions">
            <SelectTrigger
              aria-label="More actions"
              disabled={!hasScore}
              className="h-auto w-auto gap-1 px-2 py-1.5"
            >
              <EllipsisHorizontalIcon className={ICON_GLYPH_CLASS} />
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            <SelectItem value="select-all">Select all notes</SelectItem>
            <SelectItem value="add-measure">Add measure</SelectItem>
            <SelectItem value="delete-measure">Delete measure at caret</SelectItem>
          </SelectContent>
        </Select>

        <VerticalDivider />
      </div>

      {/* Pinned outside the scroller with the inspector toggle: these change how
          you look at the score, not the score itself, and they were the first
          things to disappear behind the horizontal scroll — measured at 1440px,
          362px of the bar was unreachable, and zoom and layout were in it. */}
      <div className="flex shrink-0 items-center gap-0.5 border-l border-theme-border pl-1">
        <div className="flex items-center gap-0.5">
          <Tooltip placement="bottom" content="Zoom out">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom out"
              onClick={handleZoomOut}
              className={ICON_BUTTON_CLASS}
            >
              <MagnifyingGlassMinusIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
          <Tooltip placement="bottom" content="Current zoom level">
            <span
              aria-label="Current zoom level"
              className="min-w-[40px] text-center text-sm text-theme-text-primary"
            >
              {zoomLabel}
            </span>
          </Tooltip>
          <Tooltip placement="bottom" content="Zoom in">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom in"
              onClick={handleZoomIn}
              className={ICON_BUTTON_CLASS}
            >
              <MagnifyingGlassPlusIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
        </div>
        <div role="group" aria-label="Layout mode" className="flex items-center gap-0.5">
          <Tooltip placement="bottom" content="Wrap systems to the page width">
            <Button
              type="button"
              variant="ghost"
              aria-label="Page layout"
              aria-pressed={layoutMode === 'page'}
              onClick={() => onLayoutModeChange('page')}
              className={TOGGLE_BUTTON_CLASS}
            >
              <PageLayoutIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
          <Tooltip placement="bottom" content="Lay the score out in one scrolling line">
            <Button
              type="button"
              variant="ghost"
              aria-label="Continuous layout"
              aria-pressed={layoutMode === 'continuous'}
              onClick={() => onLayoutModeChange('continuous')}
              className={TOGGLE_BUTTON_CLASS}
            >
              <ContinuousLayoutIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
        </div>
        <div role="group" aria-label="Pitch display" className="flex items-center gap-0.5">
          <Tooltip
            placement="bottom"
            content="Show each player's written pitch, or what the score sounds"
          >
            <Button
              type="button"
              variant="ghost"
              // The label names what clicking *does*, not the current state,
              // which is what a button should say — so the two names below are
              // two states of one control, not two controls.
              aria-label={pitchDisplay === 'written' ? 'Show concert pitch' : 'Show written pitch'}
              aria-pressed={pitchDisplay === 'written'}
              onClick={() =>
                store.getState().setPitchDisplay(pitchDisplay === 'written' ? 'concert' : 'written')
              }
              className={TOGGLE_BUTTON_CLASS}
            >
              {pitchDisplay === 'written' ? 'Wrt' : 'Con'}
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Outside the scroller, so it stays reachable however narrow the window
          gets. It controls the inspector, not the score, which is why it sits
          apart from the tools rather than among them. */}
      {onToggleInspector && (
        <div className="flex shrink-0 items-center pr-1">
          <Tooltip placement="bottom" content={inspectorOpen ? 'Hide inspector' : 'Show inspector'}>
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
