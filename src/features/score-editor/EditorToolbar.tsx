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
import { commandLabel } from '@/features/score-editor/command-labels';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import type {
  Accidental,
  Articulation,
  DurationName,
  Ornament,
  Pitch,
} from '@sudobility/music_types';
import { ticksFor } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import {
  addTrackCommand,
  createId,
  trackMaxPolyphony,
  selectActiveTrackId,
  selectSelectedNotes,
} from '@sudobility/music_lib';
import type { EditMode } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { durationParts, withBase, withModifier } from '@/features/score-editor/duration-modifiers';
import { durationDisplay } from '@/features/score-editor/duration-selection';
import type { BaseDuration } from '@/features/score-editor/duration-modifiers';
import { TrackVisibilitySelect } from '@/features/score-editor/TrackVisibilitySelect';
import { dispatchTracked } from '@/features/score-editor/editing';
import type { ReactElement } from 'react';
import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ClipboardIcon,
  EllipsisHorizontalIcon,
  DocumentDuplicateIcon,
  MagnifyingGlassMinusIcon,
  PencilIcon,
  MagnifyingGlassPlusIcon,
  PlusIcon,
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
  ICON_CONTROL_CLASS,
  ICON_GLYPH_CLASS,
  TEXT_CONTROL_CLASS,
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
  SlurIcon,
  FermataIcon,
  OrnamentIcon,
} from '@/components/icons/notation-icons';
import {
  addMeasure,
  deleteMeasureAtCaret,
  deleteSelected,
  changeAccidental,
  changeArticulation,
  changeOrnament,
  changeDuration,
  insertNoteAtCaret,
  insertRestAtSelection,
  quantizeSelection,
  selectAll,
  toggleFermata,
  toggleSlur,
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
  /** Opens the Go to bar prompt. Omitted in isolation tests. */
  onGoToBar?: () => void;
  /** Starts lyric entry on the active track. Omitted in isolation tests. */
  onEnterLyrics?: () => void;
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

/**
 * The note glyph for a base duration, for the merged control's trigger.
 *
 * Carries `data-duration` because the glyph is a path, not text: without it
 * "which duration is the toolbar showing" is only answerable by eye.
 */
function SelectedDurationIcon({ base }: { base: BaseDuration }) {
  const option = DURATION_OPTIONS.find((o) => o.value === base) ?? DURATION_OPTIONS[2];
  return (
    <option.Icon className={ICON_GLYPH_CLASS} data-testid="duration-glyph" data-duration={base} />
  );
}

const ACCIDENTAL_OPTIONS: Array<{ value: Accidental; Icon: NotationIcon; ariaLabel: string }> = [
  { value: -2, Icon: DoubleFlatIcon, ariaLabel: 'Double flat' },
  { value: -1, Icon: FlatIcon, ariaLabel: 'Flat' },
  { value: 0, Icon: NaturalIcon, ariaLabel: 'Natural' },
  { value: 1, Icon: SharpIcon, ariaLabel: 'Sharp' },
  { value: 2, Icon: DoubleSharpIcon, ariaLabel: 'Double sharp' },
];

/** Radix rejects an empty item value, so "None" travels under a sentinel. */
const NO_ARTICULATION = 'none';

const ARTICULATION_OPTIONS: Array<{ value: Articulation | undefined; labelKey: string }> = [
  { value: undefined, labelKey: 'articulation.none' },
  { value: 'staccato', labelKey: 'articulation.staccato' },
  { value: 'accent', labelKey: 'articulation.accent' },
  { value: 'tenuto', labelKey: 'articulation.tenuto' },
  { value: 'marcato', labelKey: 'articulation.marcato' },
];

/**
 * The ornament signs, in the order a picker should offer them.
 *
 * Shares `NO_ARTICULATION`'s problem and its fix: Radix rejects an empty item
 * value, so "None" travels under a sentinel.
 */
const NO_ORNAMENT = 'none';

const ORNAMENT_OPTIONS: Array<{ value: Ornament | undefined; labelKey: string }> = [
  { value: undefined, labelKey: 'ornament.none' },
  { value: 'trill', labelKey: 'ornament.trill' },
  { value: 'mordent', labelKey: 'ornament.mordent' },
  { value: 'inverted-mordent', labelKey: 'ornament.inverted-mordent' },
  { value: 'turn', labelKey: 'ornament.turn' },
];

/**
 * Quantize grid values, with the short label the trigger shows.
 *
 * "1/16" rather than "thirtysecond": the full words made this the widest
 * control on the bar, for a setting that is read at a glance and changed
 * rarely. The menu still spells them out.
 */
const QUANTIZE_GRID_OPTIONS: Array<{ value: DurationName; short: string; labelKey: string }> = [
  { value: 'quarter', short: '1/4', labelKey: 'importMidi.gridQuarter' },
  { value: 'eighth', short: '1/8', labelKey: 'importMidi.gridEighth' },
  { value: 'sixteenth', short: '1/16', labelKey: 'importMidi.gridSixteenth' },
  { value: 'thirtysecond', short: '1/32', labelKey: 'importMidi.gridThirtySecond' },
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

/** Every icon-only control on the bar, at the shared control height. */
const ICON_BUTTON_CLASS = ICON_CONTROL_CLASS;

const TOGGLE_BUTTON_CLASS = cn(
  TEXT_CONTROL_CLASS,
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
  onGoToBar,
  onEnterLyrics,
  onGenerateTrack,
}: EditorToolbarProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const snapGrid = store((s) => s.snapGrid);
  const selectedNotes = store(selectSelectedNotes);
  /**
   * What the one duration control shows: the armed length with nothing
   * selected, the selection's own length when they agree, "…" when they do not.
   */
  const durationShown = useMemo(
    () => durationDisplay(selectedNotes, score?.ppq ?? 480, snapGrid),
    [selectedNotes, score?.ppq, snapGrid],
  );
  /**
   * Radix needs a value that matches an item, and "mixed" matches none — so the
   * trigger renders its own content and this only decides which row is ticked.
   */
  const durationValue = durationShown.kind === 'mixed' ? '' : durationShown.base;
  const editMode = store((s) => s.editMode);
  const pitchDisplay = store((s) => s.pitchDisplay);
  const activeVoiceIndex = store((s) => s.activeVoiceIndex);
  const activeTrackId = store(selectActiveTrackId);
  const activeTrack = score?.tracks.find((t) => t.id === activeTrackId) ?? null;
  // Through the track: a drum track's program is a kit, and Brush sits at 40 —
  // the Violin address — so the toolbar refused a three-piece drum hit.
  const canStack = activeTrack === null || trackMaxPolyphony(activeTrack) > 1;

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
      label: t('editor.insertMode'),
      hint: t('editor.insertModeHint'),
    },
    {
      value: 'replace',
      Icon: ReplaceModeIcon,
      label: t('editor.replaceMode'),
      hint: t('editor.replaceModeHint'),
    },
    {
      value: 'stack',
      Icon: ChordIcon,
      label: t('editor.stackMode'),
      hint: canStack
        ? t('editor.stackModeHint')
        : t('editor.stackModeUnavailable', {
            instrument: activeTrack?.instrumentName ?? t('editor.thisInstrument'),
          }),
    },
  ];
  /**
   * Content editing is refused while the transport plays (`score-slice`'s edit
   * lock), so the controls that would dispatch a content command say so rather
   * than looking live and doing nothing.
   *
   * A boolean, so this re-renders on a transport transition only — not one of
   * the high-frequency reads that must stay out of a component's top level.
   *
   * Deliberately still enabled: Copy, which only reads the selection, and the
   * duration buttons, which also set the default insert duration and are
   * therefore useful with nothing selected.
   */
  const isPlaying = store((s) => s.state === 'playing');
  const zoom = store((s) => s.zoom);
  const hasScore = score !== null;
  const canEdit = hasScore && !isPlaying;

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
  /**
   * Paste follows the clipboard, the way Copy and Cut follow the selection.
   * It used to stay live whether or not anything had been copied, so it was the
   * one control on the bar that could look ready and do nothing.
   */
  const hasClipboard = store((s) => s.clipboard !== null);
  const noteInput = store((s) => s.noteInput);

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

  /**
   * Picking a base length keeps whatever modifier is armed, so choosing
   * "quarter" while Dotted is on gives a dotted quarter — the same thing the
   * six separate buttons did.
   */
  const handleDurationSelect = (value: string): void => {
    handleDurationClick(withBase(snapGrid, value as BaseDuration));
  };

  const handleMoreAction = (value: string): void => {
    if (value === 'select-all') selectAll(store);
    else if (value === 'add-measure') addMeasure(store);
    else if (value === 'delete-measure') deleteMeasureAtCaret(store);
    else if (value === 'go-to-bar') onGoToBar?.();
    else if (value === 'enter-lyrics') onEnterLyrics?.();
  };

  const handleAccidentalSelect = (value: string): void => {
    changeAccidental(store, Number(value) as Accidental);
  };

  const handleArticulationSelect = (value: string): void => {
    changeArticulation(store, value === NO_ARTICULATION ? undefined : (value as Articulation));
  };

  const handleOrnamentSelect = (value: string): void => {
    changeOrnament(store, value === NO_ORNAMENT ? undefined : (value as Ornament));
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
        aria-label={t('editor.toolbar')}
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
        <div role="group" aria-label={t('editor.tracks')} className="flex items-center gap-0.5">
          <TrackVisibilitySelect store={store} />
          <Select
            value=""
            onValueChange={(value) => {
              if (value === 'blank') {
                const id = createId();
                dispatchTracked(
                  store,
                  addTrackCommand({ id, name: 'New track' }, commandLabel('addTrack')),
                );
                // Active immediately: you added it to work on it.
                store.getState().setActiveTrack(id);
              } else if (value === 'generate') {
                onGenerateTrack?.();
              }
            }}
          >
            <Tooltip placement="bottom" content={t('editor.addTrack')}>
              <SelectTrigger
                aria-label={t('editor.addTrack')}
                disabled={!score || isPlaying}
                // Not the square icon class: this trigger carries the library's
                // own dropdown chevron beside the plus, and that chevron is
                // 16px by default — the one glyph in either bar that was not
                // the same size as the rest.
                className={cn(TEXT_CONTROL_CLASS, '[&_svg]:size-[18px]')}
              >
                <PlusIcon className={ICON_GLYPH_CLASS} />
              </SelectTrigger>
            </Tooltip>
            <SelectContent>
              <SelectItem value="blank">{t('editor.blankTrack')}</SelectItem>
              <SelectItem value="generate">{t('editor.generateTrack')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <VerticalDivider />

        {/* One click does two things -- arms the length for the next note AND
          retypes the selection -- and the pressed state only ever showed the
          first. The tooltip has to say both, or the second looks like the
          editor changing notes you did not ask it to. */}
        {/* One control, not six toggles. What it shows depends on the
            selection — see `durationDisplay` — and choosing a value both
            rewrites every selected note and arms the next one, so the control
            never has to explain which of its two jobs it is doing. */}
        {/* No `role="group"` wrapper: it exists to bind several controls under
            one name, and there is one control here — a group sharing the
            control's own name makes both ambiguous to a screen reader. */}
        <Select value={durationValue} onValueChange={handleDurationSelect}>
          <Tooltip
            placement="bottom"
            content={
              durationShown.kind === 'mixed'
                ? 'The selected notes are different lengths — pick one to make them all match'
                : 'Note length — for the notes you add, and for any that are selected'
            }
          >
            <SelectTrigger
              aria-label={t('editor.noteDuration')}
              disabled={!hasScore}
              className={cn(TEXT_CONTROL_CLASS, 'w-[74px] justify-between [&_svg]:size-[18px]')}
            >
              {durationShown.kind === 'mixed' ? (
                // Not the first note's icon and not the armed one: either
                // would claim the selection is something it is not.
                <span aria-hidden="true">…</span>
              ) : (
                <SelectedDurationIcon base={durationShown.base} />
              )}
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            {DURATION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="flex items-center gap-2">
                  <option.Icon className={ICON_GLYPH_CLASS} />
                  {option.ariaLabel}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div
          role="group"
          aria-label={t('editor.durationModifier')}
          className="flex items-center gap-0.5"
        >
          <Tooltip placement="bottom" content={t('editor.dottedHint')}>
            <Button
              type="button"
              variant="ghost"
              aria-label={t('editor.dotted')}
              aria-pressed={durationParts(snapGrid).modifier === 'dotted'}
              disabled={!hasScore}
              onClick={() => handleDurationClick(withModifier(snapGrid, 'dotted'))}
              className={TOGGLE_BUTTON_CLASS}
            >
              <DottedIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
          <Tooltip placement="bottom" content={t('editor.tripletHint')}>
            <Button
              type="button"
              variant="ghost"
              aria-label={t('editor.triplet')}
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
          <Tooltip placement="bottom" content={t('editor.accidentalHint')}>
            <SelectTrigger
              aria-label={t('editor.accidental')}
              disabled={!canEdit || !hasSelection}
              className={cn(TEXT_CONTROL_CLASS, '[&_svg]:size-[18px]')}
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
          <Tooltip placement="bottom" content={t('editor.articulationHint')}>
            <SelectTrigger
              aria-label={t('editor.articulation')}
              disabled={!canEdit || !hasSelection}
              className={cn(ICON_BUTTON_CLASS, '[&>svg:last-child]:hidden [&_svg]:size-[18px]')}
            >
              <ArticulationIcon className={ICON_GLYPH_CLASS} />
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            {ARTICULATION_OPTIONS.map((option) => (
              <SelectItem key={option.labelKey} value={option.value ?? NO_ARTICULATION}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/*
          The ornament sign. A Select like the articulation beside it and for
          the same reasons — several mutually exclusive choices, and the
          trigger applies rather than reflects, so `value` stays empty.
        */}
        <Select value="" onValueChange={handleOrnamentSelect}>
          <Tooltip placement="bottom" content={t('editor.ornamentHint')}>
            <SelectTrigger
              aria-label={t('editor.ornament')}
              disabled={!canEdit || !hasSelection}
              className={cn(ICON_BUTTON_CLASS, '[&>svg:last-child]:hidden [&_svg]:size-[18px]')}
            >
              <OrnamentIcon className={ICON_GLYPH_CLASS} />
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            {ORNAMENT_OPTIONS.map((option) => (
              <SelectItem key={option.labelKey} value={option.value ?? NO_ORNAMENT}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tooltip placement="bottom" content={t('editor.toggleTie')}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('editor.toggleTie')}
            disabled={!canEdit || !hasSelection}
            onClick={() => toggleTie(store, 'tieStart')}
            className={ICON_BUTTON_CLASS}
          >
            <TieIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        <VerticalDivider />

        <div role="group" aria-label={t('editor.editMode')} className="flex items-center gap-0.5">
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
        <Tooltip placement="bottom" content={t('editor.insertNoteHint')}>
          <Button
            type="button"
            variant="outline"
            aria-label={t('editor.insertNote')}
            disabled={!canEdit}
            onClick={handleInsertNote}
            className={ICON_BUTTON_CLASS}
          >
            <InsertNoteIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>
        {/*
          Note input: while it is on, a click on a stave writes a note at that
          pitch instead of moving the caret. Pressed-state on the button and a
          shortcut of its own, because a mode that changes what a click does
          must be visible at a glance.
        */}
        {/*
          A phrase mark over the selection. Needs two notes — one note cannot
          carry a slur — so it disables rather than doing nothing.
        */}
        <Tooltip placement="bottom" content={t('editor.slurHint')}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('editor.slur')}
            disabled={!canEdit || selection.eventIds.length < 2}
            onClick={() => toggleSlur(store)}
            className={TOGGLE_BUTTON_CLASS}
          >
            <SlurIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        {/*
          A pause on the selection. One note is enough, unlike the slur beside
          it — a fermata belongs to a single note — so it only needs something
          selected.
        */}
        <Tooltip placement="bottom" content={t('editor.fermataHint')}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('editor.fermata')}
            disabled={!canEdit || selection.eventIds.length === 0}
            onClick={() => toggleFermata(store)}
            className={TOGGLE_BUTTON_CLASS}
          >
            <FermataIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        <Tooltip placement="bottom" content={t('editor.noteInputHint')}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('editor.noteInput')}
            aria-pressed={noteInput}
            disabled={!canEdit}
            onClick={() => store.getState().setNoteInput(!noteInput)}
            className={TOGGLE_BUTTON_CLASS}
          >
            <PencilIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        <Tooltip placement="bottom" content={t('editor.insertRestHint')}>
          <Button
            type="button"
            variant="outline"
            aria-label={t('editor.insertRest')}
            disabled={!canEdit}
            onClick={handleInsertRest}
            className={ICON_BUTTON_CLASS}
          >
            <InsertRestIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>
        <div role="group" aria-label={t('editor.clipboard')} className="flex items-center gap-0.5">
          <Tooltip placement="bottom" content={t('editor.copyHint')}>
            <Button
              type="button"
              variant="outline"
              aria-label={t('editor.copy')}
              disabled={!hasScore || !hasSelection}
              onClick={() => store.getState().copySelection()}
              className={ICON_BUTTON_CLASS}
            >
              <DocumentDuplicateIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
          <Tooltip placement="bottom" content={t('editor.cutHint')}>
            <Button
              type="button"
              variant="outline"
              aria-label={t('editor.cut')}
              disabled={!canEdit || !hasSelection}
              onClick={onCut}
              className={ICON_BUTTON_CLASS}
            >
              <ScissorsIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
          <Tooltip placement="bottom" content={t('editor.pasteHint')}>
            <Button
              type="button"
              variant="outline"
              aria-label={t('editor.paste')}
              disabled={!canEdit || !hasClipboard}
              onClick={onPaste}
              className={ICON_BUTTON_CLASS}
            >
              <ClipboardIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
        </div>

        <Tooltip placement="bottom" content={t('editor.deleteHint')}>
          <Button
            type="button"
            variant="outline"
            aria-label={t('editor.deleteSelection')}
            disabled={!canEdit || !hasSelection}
            onClick={() => deleteSelected(store)}
            className={ICON_BUTTON_CLASS}
          >
            <TrashIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        <VerticalDivider />

        <Tooltip placement="bottom" content={t('editor.quantizeGridHint')}>
          <Select value={quantizeGrid} onValueChange={handleQuantizeGridChange}>
            <SelectTrigger
              aria-label={t('editor.quantizeGrid')}
              // The trigger's own chevron is 16px by default; this brings it in
              // line with every other icon on the bar.
              className={cn(TEXT_CONTROL_CLASS, '[&_svg]:size-[18px]')}
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
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Tooltip>
        <Tooltip placement="bottom" content={t('editor.quantizeHint')}>
          <Button
            type="button"
            variant="outline"
            aria-label={t('editor.quantize')}
            disabled={!canEdit || !hasSelection}
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
        <div role="group" aria-label={t('editor.voice')} className="flex items-center gap-0.5">
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
          <Tooltip placement="bottom" content={t('editor.moreActions')}>
            <SelectTrigger
              aria-label={t('editor.moreActions')}
              disabled={!hasScore}
              className={cn(TEXT_CONTROL_CLASS, '[&_svg]:size-[18px]')}
            >
              <EllipsisHorizontalIcon className={ICON_GLYPH_CLASS} />
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            <SelectItem value="select-all">{t('editor.selectAllNotes')}</SelectItem>
            <SelectItem value="add-measure">{t('editor.addMeasure')}</SelectItem>
            <SelectItem value="delete-measure">{t('editor.deleteMeasure')}</SelectItem>
            <SelectItem value="go-to-bar">{t('editor.goToBar')}</SelectItem>
            <SelectItem value="enter-lyrics">{t('editor.enterLyrics')}</SelectItem>
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
          <Tooltip placement="bottom" content={t('editor.zoomOut')}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('editor.zoomOut')}
              onClick={handleZoomOut}
              className={ICON_BUTTON_CLASS}
            >
              <MagnifyingGlassMinusIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
          <Tooltip placement="bottom" content={t('editor.currentZoom')}>
            <span
              aria-label={t('editor.currentZoom')}
              className="min-w-[40px] text-center text-sm text-theme-text-primary"
            >
              {zoomLabel}
            </span>
          </Tooltip>
          <Tooltip placement="bottom" content={t('editor.zoomIn')}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('editor.zoomIn')}
              onClick={handleZoomIn}
              className={ICON_BUTTON_CLASS}
            >
              <MagnifyingGlassPlusIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
        </div>
        <div role="group" aria-label={t('editor.layoutMode')} className="flex items-center gap-0.5">
          <Tooltip placement="bottom" content={t('editor.pageHint')}>
            <Button
              type="button"
              variant="ghost"
              aria-label={t('editor.pageLayout')}
              aria-pressed={layoutMode === 'page'}
              onClick={() => onLayoutModeChange('page')}
              className={TOGGLE_BUTTON_CLASS}
            >
              <PageLayoutIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
          <Tooltip placement="bottom" content={t('editor.continuousHint')}>
            <Button
              type="button"
              variant="ghost"
              aria-label={t('editor.continuousLayout')}
              aria-pressed={layoutMode === 'continuous'}
              onClick={() => onLayoutModeChange('continuous')}
              className={TOGGLE_BUTTON_CLASS}
            >
              <ContinuousLayoutIcon className={ICON_GLYPH_CLASS} />
            </Button>
          </Tooltip>
        </div>
        <div
          role="group"
          aria-label={t('settings.pitchDisplay')}
          className="flex items-center gap-0.5"
        >
          <Tooltip placement="bottom" content={t('editor.pitchDisplayHint')}>
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
              aria-label={t('editor.toggleInspector')}
              onClick={onToggleInspector}
              className={ICON_BUTTON_CLASS}
            >
              {inspectorOpen ? (
                <ChevronDoubleRightIcon className={ICON_GLYPH_CLASS} />
              ) : (
                <ChevronDoubleLeftIcon className={ICON_GLYPH_CLASS} />
              )}
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
