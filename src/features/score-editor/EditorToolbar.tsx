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
import {
  ACCIDENTAL_OPTIONS,
  ARTICULATION_OPTIONS,
  NO_MARK,
  ORNAMENT_OPTIONS,
} from '@sudobility/music_types';
import type { Accidental, Articulation, DurationName, Ornament } from '@sudobility/music_types';
import { useAppStore } from '@/app-library';
import { selectSelectedNotes } from '@/app-library';
import type { EditMode } from '@/app-library';
import type { LayoutMode } from '@sudobility/music_types';
import type { EditorStoreApi } from '@/app-library';
import { durationParts, withBase, withModifier } from '@/app-library';
import { durationDisplay } from '@/app-library';
import type { BaseDuration } from '@/app-library';
import { TrackVisibilitySelect } from '@/features/score-editor/TrackVisibilitySelect';
import type { ReactElement } from 'react';
import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  EllipsisHorizontalIcon,
  MagnifyingGlassMinusIcon,
  PencilIcon,
  MagnifyingGlassPlusIcon,
  PlusIcon,
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
  ArpeggioIcon,
  BeamBreakIcon,
  BeamNoneIcon,
  CrescendoIcon,
  DiminuendoIcon,
  OrnamentIcon,
} from '@/components/icons/notation-icons';
import {
  changeAccidental,
  changeArticulation,
  changeOrnament,
  chooseDuration,
  selectSelectedTrack,
  chooseEditMode,
  insertDefaultNoteAtCaret,
  insertRestAtSelection,
  quantizeSelectionToGrid,
  zoomIn,
  zoomOut,
  changeBeam,
  toggleArpeggiate,
  toggleFermata,
  toggleHairpin,
  toggleSlur,
  toggleTie,
  selectToolbarAvailability,
  selectEffectiveEditMode,
  editModeHintKey,
  voiceHintKey,
  addTrackChoices,
  runAddTrackChoice,
  runMoreAction,
  EDIT_MODE_OPTIONS,
  EDITOR_MORE_ACTIONS,
  EDITOR_VOICE_COUNT,
  QUANTIZE_GRIDS,
  QUANTIZE_GRID_SHORT,
} from '@/app-library';
import type { EditorMoreAction, QuantizeGrid } from '@/app-library';

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
const DURATION_OPTIONS: Array<{ value: BaseDuration; Icon: NotationIcon }> = [
  { value: 'whole', Icon: WholeNoteIcon },
  { value: 'half', Icon: HalfNoteIcon },
  { value: 'quarter', Icon: QuarterNoteIcon },
  { value: 'eighth', Icon: EighthNoteIcon },
  { value: 'sixteenth', Icon: SixteenthNoteIcon },
  { value: 'thirtysecond', Icon: ThirtySecondNoteIcon },
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

/**
 * The glyph and the spoken name for each accidental.
 *
 * A `Record` keyed by the vocabulary rather than a list beside it: a sixth
 * accidental fails to compile here instead of quietly going missing. The
 * vocabulary and its *order* are music_types' — `ACCIDENTAL_OPTIONS`, which the
 * menu below is built from — because a drawing is the one thing a shared
 * vocabulary cannot carry, and everything else about the list can be.
 */
const ACCIDENTAL_GLYPHS: Record<Accidental, NotationIcon> = {
  [-2]: DoubleFlatIcon,
  [-1]: FlatIcon,
  [0]: NaturalIcon,
  [1]: SharpIcon,
  [2]: DoubleSharpIcon,
};

/*
  The articulation and ornament entries are music_types', imported above.

  Both lists lived here as well as in the inspector and in both of the native
  app's pickers, and the four agreed only because nobody had added a fifth
  member yet. `NO_MARK` is the library's sentinel for "none": a picker's value
  is a string, and Radix rejects an empty one.
*/

/**
 * The words each quantize grid is spelled out as in the menu.
 *
 * The grids themselves, and the short "1/16" the trigger shows, are
 * music_types' (`QUANTIZE_GRIDS`, `QUANTIZE_GRID_SHORT`) — the native bar
 * offers the same four. The short form rather than "thirtysecond" because the
 * full words made this the widest control on the bar, for a setting read at a
 * glance and changed rarely. A `Record`, so a fifth grid fails to compile here.
 */
const QUANTIZE_GRID_LABEL_KEY: Record<QuantizeGrid, string> = {
  quarter: 'importMidi.gridQuarter',
  eighth: 'importMidi.gridEighth',
  sixteenth: 'importMidi.gridSixteenth',
  thirtysecond: 'importMidi.gridThirtySecond',
};

/** The glyph for each edit mode; the order, labels and hints are music_types'. */
const EDIT_MODE_GLYPHS: Record<EditMode, NotationIcon> = {
  insert: InsertModeIcon,
  replace: ReplaceModeIcon,
  stack: ChordIcon,
};

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
  const pitchDisplay = store((s) => s.pitchDisplay);
  const activeVoiceIndex = store((s) => s.activeVoiceIndex);
  const activeTrack = store(selectSelectedTrack);
  /**
   * Which controls can be used right now: music_editing's rules, shared with
   * the native bar, so the two cannot disagree about when a glissando can be
   * written.
   *
   * Content is refused while the transport plays (`score-slice`'s edit lock),
   * and a control that invites a click and does nothing is worse than one
   * plainly unavailable — so the selection-only controls are off with nothing
   * selected, and every content control is off while playing. The duration
   * control stays live then: it also arms the next note.
   *
   * Reference-stable while no answer changes, so this re-renders on a
   * transition only — not one of the high-frequency reads that must stay out
   * of a component's top level.
   */
  const available = store(selectToolbarAvailability);
  /*
    The mode a write will actually use. Stack on a part that cannot play a chord
    reads as replace (asked through the *track*, because a drum track's program
    is a kit: Brush sits at 40, the Violin address).

    Only shown, never written back: chord entry and paste read the same
    selector at the point of writing, so the stored choice stays the person's
    and switching back to a piano gives stack back.
  */
  const effectiveEditMode = store(selectEffectiveEditMode);

  const zoom = store((s) => s.zoom);
  const noteInput = store((s) => s.noteInput);

  const [quantizeGrid, setQuantizeGrid] = useState<QuantizeGrid>('sixteenth');
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
    chooseDuration(store, value);
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
    runMoreAction(store, value as EditorMoreAction, {
      goToBar: onGoToBar,
      enterLyrics: onEnterLyrics,
    });
  };

  const handleAccidentalSelect = (value: string): void => {
    changeAccidental(store, Number(value) as Accidental);
  };

  const handleArticulationSelect = (value: string): void => {
    changeArticulation(store, value === NO_MARK ? undefined : (value as Articulation));
  };

  const handleOrnamentSelect = (value: string): void => {
    changeOrnament(store, value === NO_MARK ? undefined : (value as Ornament));
  };

  /** Writes the default pitch at the caret and steps past it, so a second press continues the line. */
  const handleInsertNote = (): void => {
    insertDefaultNoteAtCaret(store);
  };

  const handleInsertRest = (): void => {
    insertRestAtSelection(store);
  };

  const handleQuantizeGridChange = (value: string): void => {
    setQuantizeGrid(value as QuantizeGrid);
  };

  const handleQuantize = (): void => {
    void quantizeSelectionToGrid(store, quantizeGrid);
  };

  const handleZoomIn = (): void => store.getState().setZoom(zoomIn(zoom));
  const handleZoomOut = (): void => store.getState().setZoom(zoomOut(zoom));

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
            onValueChange={(value) =>
              runAddTrackChoice(store, value as 'blank' | 'generate', {
                generateTrack: onGenerateTrack,
              })
            }
          >
            <Tooltip placement="bottom" content={t('editor.addTrack')}>
              <SelectTrigger
                aria-label={t('editor.addTrack')}
                disabled={!available.addTrack}
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
              {/* Generate is disabled rather than dropped with no host to send it
                  to, so the menu keeps its shape. */}
              {addTrackChoices({ canGenerate: onGenerateTrack !== undefined }).map((choice) => (
                <SelectItem key={choice.value} value={choice.value} disabled={choice.disabled}>
                  {t(choice.labelKey)}
                </SelectItem>
              ))}
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
                ? t('editor.mixedDurationsHint')
                : t('editor.noteDurationHint')
            }
          >
            <SelectTrigger
              aria-label={t('editor.noteDuration')}
              disabled={!available.noteDuration}
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
                  {t(`duration.${option.value}`)}
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
              disabled={!available.dotted}
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
              disabled={!available.triplet}
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
              disabled={!available.accidental}
              className={cn(TEXT_CONTROL_CLASS, '[&_svg]:size-[18px]')}
            >
              <SharpIcon className={ICON_GLYPH_CLASS} />
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            {ACCIDENTAL_OPTIONS.map(({ value, labelKey }) => {
              const Glyph = ACCIDENTAL_GLYPHS[value];
              return (
                <SelectItem key={String(value)} value={String(value)}>
                  <span className="flex items-center gap-2">
                    <Glyph className={ICON_GLYPH_CLASS} />
                    {t(labelKey)}
                  </span>
                </SelectItem>
              );
            })}
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
              disabled={!available.articulation}
              className={cn(ICON_BUTTON_CLASS, '[&>svg:last-child]:hidden [&_svg]:size-[18px]')}
            >
              <ArticulationIcon className={ICON_GLYPH_CLASS} />
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            {ARTICULATION_OPTIONS.map((option) => (
              <SelectItem key={option.labelKey} value={option.value}>
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
              disabled={!available.ornament}
              className={cn(ICON_BUTTON_CLASS, '[&>svg:last-child]:hidden [&_svg]:size-[18px]')}
            >
              <OrnamentIcon className={ICON_GLYPH_CLASS} />
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            {ORNAMENT_OPTIONS.map((option) => (
              <SelectItem key={option.labelKey} value={option.value}>
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
            disabled={!available.tie}
            onClick={() => toggleTie(store, 'tieStart')}
            className={ICON_BUTTON_CLASS}
          >
            <TieIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        <VerticalDivider />

        <div role="group" aria-label={t('editor.editMode')} className="flex items-center gap-0.5">
          {EDIT_MODE_OPTIONS.map((option) => {
            const Glyph = EDIT_MODE_GLYPHS[option.value];
            return (
              <Tooltip
                placement="bottom"
                key={option.value}
                content={t(editModeHintKey(option.value, available.stackMode), {
                  instrument: activeTrack?.instrumentName ?? t('editor.thisInstrument'),
                })}
              >
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t(option.labelKey)}
                  aria-pressed={effectiveEditMode === option.value}
                  disabled={!available[`${option.value}Mode`]}
                  onClick={() => chooseEditMode(store, option.value)}
                  className={TOGGLE_BUTTON_CLASS}
                >
                  <Glyph className={ICON_GLYPH_CLASS} />
                </Button>
              </Tooltip>
            );
          })}
        </div>
        <Tooltip placement="bottom" content={t('editor.insertNoteHint')}>
          <Button
            type="button"
            variant="outline"
            aria-label={t('editor.insertNote')}
            disabled={!available.insertNote}
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
            disabled={!available.slur}
            onClick={() => toggleSlur(store)}
            className={TOGGLE_BUTTON_CLASS}
          >
            <SlurIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        {/*
          The hairpins. Two buttons rather than a menu: crescendo and
          diminuendo are the two things anybody reaches for, and a wedge is
          faster to recognise as a shape than to read as a word. Two notes
          minimum, like the slur — a wedge over one note has nowhere to open.
        */}
        <Tooltip placement="bottom" content={t('editor.crescendoHint')}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('editor.crescendo')}
            disabled={!available.crescendo}
            onClick={() => toggleHairpin(store, 'crescendo')}
            className={TOGGLE_BUTTON_CLASS}
          >
            <CrescendoIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        <Tooltip placement="bottom" content={t('editor.diminuendoHint')}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('editor.diminuendo')}
            disabled={!available.diminuendo}
            onClick={() => toggleHairpin(store, 'diminuendo')}
            className={TOGGLE_BUTTON_CLASS}
          >
            <DiminuendoIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        {/* Rolling a chord. One note is enough to select; a lone note simply
            draws nothing. */}
        <Tooltip placement="bottom" content={t('editor.arpeggiateHint')}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('editor.arpeggiate')}
            disabled={!available.arpeggiate}
            onClick={() => toggleArpeggiate(store)}
            className={TOGGLE_BUTTON_CLASS}
          >
            <ArpeggioIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        {/*
          Beaming overrides. One note is enough for either: a break is a
          property of the note it sits on rather than a span, and so is taking
          a note out of beaming altogether. Both are toggles — applying the
          mode already in force clears it, so "break here" and "undo the
          break" cannot produce two scores that draw identically.
        */}
        <Tooltip placement="bottom" content={t('editor.beamBreakHint')}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('editor.beamBreak')}
            disabled={!available.beamBreak}
            onClick={() => changeBeam(store, 'break')}
            className={TOGGLE_BUTTON_CLASS}
          >
            <BeamBreakIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        <Tooltip placement="bottom" content={t('editor.beamNoneHint')}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('editor.beamNone')}
            disabled={!available.beamNone}
            onClick={() => changeBeam(store, 'none')}
            className={TOGGLE_BUTTON_CLASS}
          >
            <BeamNoneIcon className={ICON_GLYPH_CLASS} />
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
            disabled={!available.fermata}
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
            disabled={!available.noteInput}
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
            disabled={!available.insertRest}
            onClick={handleInsertRest}
            className={ICON_BUTTON_CLASS}
          >
            <InsertRestIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>
        {/*
          Copy, Cut, Paste and Delete used to sit here.

          They moved to the score's own context menu — right-click, or long-press
          on a touch screen — because all four act on something already selected
          and none of them could say *what*. Delete means three different edits
          depending on whether a track, a span of bars or a run of notes is
          selected, and a permanently visible button cannot name its subject. A
          menu opened on the thing itself can, and does. The keyboard shortcuts
          are unchanged.
        */}
        <VerticalDivider />

        <Tooltip placement="bottom" content={t('editor.quantizeGridHint')}>
          <Select value={quantizeGrid} onValueChange={handleQuantizeGridChange}>
            <SelectTrigger
              aria-label={t('editor.quantizeGrid')}
              disabled={!available.quantizeGrid}
              // The trigger's own chevron is 16px by default; this brings it in
              // line with every other icon on the bar.
              className={cn(TEXT_CONTROL_CLASS, '[&_svg]:size-[18px]')}
            >
              {/* The short form, not `SelectValue`: the trigger is read at a
                glance and was the widest control on the bar. */}
              <span>{QUANTIZE_GRID_SHORT[quantizeGrid]}</span>
            </SelectTrigger>
            <SelectContent>
              {QUANTIZE_GRIDS.map((grid) => (
                <SelectItem key={grid} value={grid}>
                  {t(QUANTIZE_GRID_LABEL_KEY[grid])}
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
            disabled={!available.quantize}
            onClick={handleQuantize}
            className={ICON_BUTTON_CLASS}
          >
            <QuantizeIcon className={ICON_GLYPH_CLASS} />
          </Button>
        </Tooltip>

        <VerticalDivider />

        <VerticalDivider />

        {/* How many voices is music_types' `EDITOR_VOICE_COUNT` (two: stems
          up against stems down on one stave). The hints used to be English
          literals here, which no parity test could see. */}
        <div role="group" aria-label={t('editor.voice')} className="flex items-center gap-0.5">
          {Array.from({ length: EDITOR_VOICE_COUNT }, (_, index) => (
            <Tooltip placement="bottom" key={index} content={t(voiceHintKey(index))}>
              <Button
                type="button"
                variant="ghost"
                aria-label={t('editor.voiceNumber', { number: index + 1 })}
                aria-pressed={activeVoiceIndex === index}
                disabled={!available.voice}
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
              disabled={!available.moreActions}
              className={cn(TEXT_CONTROL_CLASS, '[&_svg]:size-[18px]')}
            >
              <EllipsisHorizontalIcon className={ICON_GLYPH_CLASS} />
            </SelectTrigger>
          </Tooltip>
          <SelectContent>
            {/*
              The entries and their order are music_types', shared with the
              native More menu, and each is disabled exactly when its control
              would be: a slide needs two notes, and bars and lyrics are content,
              so they lock while the transport plays. Glissando is here rather
              than on the bar for the reason everything in this menu is — a mark
              reached for occasionally, on a bar already the widest thing in the
              editor.
            */}
            {EDITOR_MORE_ACTIONS.map((action) => (
              <SelectItem
                key={action.value}
                value={action.value}
                disabled={!available[action.control]}
              >
                {t(action.labelKey)}
              </SelectItem>
            ))}
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
              aria-label={
                pitchDisplay === 'written'
                  ? t('editor.showConcertPitch')
                  : t('editor.showWrittenPitch')
              }
              aria-pressed={pitchDisplay === 'written'}
              onClick={() =>
                store.getState().setPitchDisplay(pitchDisplay === 'written' ? 'concert' : 'written')
              }
              className={TOGGLE_BUTTON_CLASS}
            >
              {/*
                Abbreviated because the chip sits in a row of 18px glyphs, but
                translated all the same: both apps hardcoded the same two
                English letters here, which is exactly why no parity check
                could see them.
              */}
              {t(
                pitchDisplay === 'written'
                  ? 'editor.pitchWrittenShort'
                  : 'editor.pitchConcertShort',
              )}
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Outside the scroller, so it stays reachable however narrow the window
          gets. It controls the inspector, not the score, which is why it sits
          apart from the tools rather than among them. */}
      {onToggleInspector && (
        <div className="flex shrink-0 items-center pr-1">
          <Tooltip
            placement="bottom"
            content={inspectorOpen ? t('editor.hideInspector') : t('editor.showInspector')}
          >
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
