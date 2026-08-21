/**
 * Right-side inspector panel (spec §20): Note/Measure/Track tabs of
 * editable properties, driven entirely by the current `selection`.
 * Multi-selection shows "Mixed" placeholders wherever the selected
 * objects' values for a field differ (spec §20: "Multi-selection property
 * editing; show 'mixed' for differing values") — editing a mixed field
 * applies the newly-entered value uniformly to every selected object,
 * exactly like `EditorToolbar`'s duration/accidental/articulation controls
 * already do for notes.
 *
 * Every mutating field dispatches a `ScoreCommand` (via `editing.ts`'s
 * selection-aware helpers where one already exists, or `store.
 * dispatchCommand` directly otherwise) — never an ad hoc store field.
 *
 * Scope note: a note's *track* isn't editable here (no cross-track "move
 * note" command exists in `domain/commands/note-commands.ts`; only
 * within-track voice reassignment does) — the Track field is shown
 * read-only. Start position is only editable for a single-note selection
 * (an absolute tick target has no well-defined multi-note meaning without
 * per-note deltas).
 *
 * Adopts `@sudobility/components` controls (library sweep 1):
 * - Note/Measure/Track become the library's Radix-backed `Tabs`
 *   (`TabsList`/`TabsTrigger`/`TabsContent`), which already produce a real
 *   `tablist`/`tab`/`tabpanel` triad with `aria-selected`/`aria-controls`/
 *   `aria-labelledby` wired up -- a strict superset of the hand-rolled
 *   version's roles, so the existing role-based test assertions hold.
 * - `MixedSelect` becomes the library `Select`.
 * - `MixedNumberField` becomes the library `Input` (`type="number"`), not
 *   `NumberInput`: `NumberInput` requires a real numeric `value`/`onChange`
 *   pair with no way to represent "no value yet" (the empty, `placeholder=
 *   "Mixed"` box this panel needs while a multi-selection's field values
 *   differ, committed only on blur/Enter so a partial draft never
 *   dispatches a command) -- `Input` is a thin styled wrapper around a
 *   native `<input>` with full attribute passthrough, so it can keep that
 *   exact string-draft/blur-commit behavior unchanged.
 * - `MixedCheckbox` becomes the library `Checkbox` (its own `indeterminate`
 *   prop already does what this file used to do by hand via a ref).
 * - Track-tab volume/pan sliders become the library `Slider`, wrapped the
 *   same way as `TrackPanel.tsx`'s identical fields: a `<label>` with a
 *   visually-hidden accessible name (`Slider` accepts no `aria-label`) and
 *   an `onPointerUp`/`onKeyUp` commit handler (`Slider` exposes only a
 *   continuous `onChange`, no commit-on-release callback of its own).
 * - The Name/Instrument text fields (track tab) become the library `Input`.
 */
import { commandLabel } from '@/features/score-editor/command-labels';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';

import { PanSlider, VolumeSlider } from '@/features/tracks/mixer-controls';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  SheetSelector,
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@sudobility/components';
import type {
  Accidental,
  Dynamic,
  Articulation,
  Clef,
  KeySignature,
  Measure,
  NoteEvent,
  Pitch,
  PitchStep,
  DurationName,
  Score,
  TimeSignature,
} from '@sudobility/music_types';
import { DYNAMICS, isNoteEvent } from '@sudobility/music_types';
import {
  findEvent,
  findMeasure,
  findTrack,
  replacementRegion,
  selectActiveTrackId,
  soundingPitchForTrack,
  trackWrittenTransposition,
  transposeKeySignature,
  transposePitch,
  isPercussionTrack,
  barBeatForTick,
  tickForBarBeat,
  durationLabel,
  durationNameForTicks,
  keySignatureOptions,
  ticksFor,
  DURATION_NAMES,
  INSTRUMENT_OPTIONS,
  KIT_OPTIONS,
  kitOptionValue,
  selectSelectedTrack,
} from '@sudobility/music_lib';
import type { TrackMixPatch } from '@sudobility/music_lib';
import {
  changeAccidental as dispatchAccidental,
  changeArticulation as dispatchArticulation,
  changeVelocity as dispatchVelocity,
  selectedNoteIds,
  toggleTie as dispatchToggleTie,
} from '@/features/score-editor/editing';
import {
  changePitchCommand,
  changeVoiceCommand,
  moveNotesCommand,
  resizeNotesCommand,
} from '@sudobility/music_lib';
import {
  changeDynamicCommand,
  changeKeySignatureCommand,
  clearGraceNotesCommand,
  toGraceNoteCommand,
  changeTempoCommand,
  changeTimeSignatureCommand,
  removeTempoCommand,
} from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import type { ReplaceScope } from '@sudobility/music_lib';
import { ReplaceMusicDialog } from '@/features/generation/ReplaceMusicDialog';
import type { ReplaceSubmission } from '@/features/generation/ReplaceMusicDialog';

export type InspectorPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /**
   * Starts a replacement job. Omitted in isolation tests, where the buttons
   * still render and disable correctly but do nothing.
   */
  onReplace?: (scope: ReplaceScope, submission: ReplaceSubmission) => void;
};

/**
 * The Replace button each tab carries, plus its modal.
 *
 * Disabled when `replacementRegion` returns null — nothing selected for that
 * scope — which is the single source of truth for "is there anything to
 * replace", shared with the region the job will actually use.
 */
function ReplaceButton({
  store,
  scope,
  label,
  onReplace,
}: {
  store: EditorStoreApi;
  scope: ReplaceScope;
  label: string;
  onReplace?: (scope: ReplaceScope, submission: ReplaceSubmission) => void;
}) {
  const [open, setOpen] = useState(false);
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const activeTrackId = store(selectActiveTrackId);

  const region = score ? replacementRegion(score, selection, activeTrackId, scope) : null;
  const trackLabel =
    score && region?.range.trackIds.length === 1
      ? (findTrack(score, region.range.trackIds[0])?.name ?? undefined)
      : undefined;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={region === null}
        onClick={() => setOpen(true)}
        className="w-full px-3 py-1.5 text-sm"
      >
        {label}
      </Button>
      <ReplaceMusicDialog
        open={open}
        scope={scope}
        region={region}
        trackLabel={trackLabel}
        onClose={() => setOpen(false)}
        onSubmit={(submission) => {
          setOpen(false);
          onReplace?.(scope, submission);
        }}
      />
    </>
  );
}

/** Sentinel distinguishing "every selected object agrees" from "differing values" (spec §20's "mixed"). */
const MIXED = Symbol('mixed');
type MixedOr<T> = T | typeof MIXED;

/** `values[0]` if every entry deep-equals it (by `JSON.stringify`, sufficient for this panel's primitive/plain-object fields), `MIXED` if they differ, or `null` for an empty list. */
function commonValue<T>(values: T[]): MixedOr<T> | null {
  if (values.length === 0) return null;
  const first = values[0];
  const firstKey = JSON.stringify(first);
  return values.every((v) => JSON.stringify(v) === firstKey) ? first : MIXED;
}

const PITCH_STEPS: PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ACCIDENTALS: Array<{ value: Accidental; label: string }> = [
  { value: -2, label: 'bb' },
  { value: -1, label: 'b' },
  { value: 0, label: 'natural' },
  { value: 1, label: '#' },
  { value: 2, label: 'x' },
];
const ARTICULATIONS: Array<{ value: Articulation | 'none'; labelKey: string }> = [
  { value: 'none', labelKey: 'articulation.none' },
  { value: 'staccato', labelKey: 'articulation.staccato' },
  { value: 'accent', labelKey: 'articulation.accent' },
  { value: 'tenuto', labelKey: 'articulation.tenuto' },
  { value: 'marcato', labelKey: 'articulation.marcato' },
];
const CLEFS: Clef[] = ['treble', 'bass', 'alto', 'tenor', 'percussion'];
const MIXED_VALUE = '__mixed__';

/**
 * Stands for a length no single note value spells — a tie join or an import can
 * leave one. Shown so the picker states what the note actually is instead of
 * relabelling it as the nearest name, and inert when chosen.
 */
const CUSTOM_DURATION = '__custom__';

/** "No marking here", distinct from a marking that happens to be quiet. */
const NO_DYNAMIC = '__none__';

type InspectorTab = 'score' | 'note' | 'measure' | 'track';

const FIELD_LABEL_CLASS = 'text-xs text-theme-text-secondary';

/**
 * One stated height for every field in the panel.
 *
 * An `Input`, a Radix select trigger and a `SheetSelector` each size
 * themselves from their own content and padding, so a column of them comes out
 * ragged no matter how the padding is tuned — the name box, the instrument
 * picker and the clef select were three different heights. Stating it once is
 * the same rule the toolbars follow with `CONTROL_HEIGHT_CLASS`.
 */
const FIELD_HEIGHT_CLASS = 'h-9';
const TEXT_INPUT_CLASS = `${FIELD_HEIGHT_CLASS} w-full px-2 py-1.5 text-sm`;
const SELECT_CLASS = `${FIELD_HEIGHT_CLASS} w-full justify-between px-2 py-1.5 text-sm`;

/** A `Select` that renders a synthetic disabled "Mixed" option when `value` is `MIXED`, otherwise the given options. Selecting a real option always calls `onChange` with that option's own value (never `MIXED`). */
function MixedSelect<T extends string>({
  value,
  options,
  ariaLabel,
  onChange,
  disabled,
}: {
  value: MixedOr<T> | null;
  options: Array<{ value: T; label: string }>;
  ariaLabel: string;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const selectValue = value === MIXED ? MIXED_VALUE : (value ?? undefined);
  return (
    <Select
      value={selectValue}
      disabled={disabled || value === null}
      onValueChange={(v) => {
        if (v === MIXED_VALUE) return;
        onChange(v as T);
      }}
    >
      <SelectTrigger aria-label={ariaLabel} className={SELECT_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {value === MIXED && (
          <SelectItem value={MIXED_VALUE} disabled>
            {t('inspector.mixed')}
          </SelectItem>
        )}
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A numeric `<input>` (the library `Input`, `type="number"`) showing an empty value + "Mixed" placeholder when `value` is `MIXED`. Commits on blur/Enter, not on every keystroke, so a partial/invalid draft never dispatches a command.
 *
 * Kept on the library `Input` rather than `NumberInput`: `NumberInput`'s
 * `value`/`onChange` pair is a real `number`, with no representation for
 * "empty, showing a Mixed placeholder" -- exactly the state this field
 * needs whenever a multi-selection's values differ. `Input` is a thin
 * styled `<input>` with full attribute passthrough, so it keeps the same
 * string-draft/blur-commit behavior unchanged. */
function MixedNumberField({
  label,
  value,
  onCommit,
  disabled,
  min,
  max,
  step,
}: {
  label: string;
  value: MixedOr<number> | null;
  onCommit: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value === MIXED || value === null ? '' : String(value));

  useEffect(() => {
    setDraft(value === MIXED || value === null ? '' : String(value));
  }, [value]);

  const commit = (): void => {
    const parsed = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(parsed)) onCommit(parsed);
  };

  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <Input
        type="number"
        value={draft}
        placeholder={value === MIXED ? t('inspector.mixed') : undefined}
        disabled={disabled || value === null}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        className={TEXT_INPUT_CLASS}
      />
    </label>
  );
}

/** A checkbox showing an indeterminate visual state when `indeterminate` is true (the library `Checkbox`'s own `indeterminate` prop, mirroring MUI's `Checkbox indeterminate` for the "Mixed" tri-state fields -- it manages the DOM's `indeterminate` flag via ref internally, so this file no longer has to). */
function MixedCheckbox({
  label,
  checked,
  indeterminate,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  /** Only a multi-selection can be part-checked, so this defaults to off. */
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Checkbox
      label={label}
      checked={checked}
      indeterminate={indeterminate}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

/** A library `Slider` wrapped with an accessible name (via a visually-hidden
 * label, since `Slider` accepts no `aria-label`) and a commit-on-release
 * handler (since `Slider` exposes only a continuous `onChange`, no
 * `onValueCommitted`-style callback of its own) -- same pattern as
 * `TrackPanel.tsx`'s identical volume/pan sliders. */
/**
 * A mixer control that reports once, on release.
 *
 * Every commit is an undo entry, so committing per pointer-move would bury the
 * history under a drag. `kind` picks the control rather than a min/max, because
 * volume and pan are different *shapes* — see `mixer-controls.tsx`.
 */
/**
 * A note's position, as a bar and a beat.
 *
 * Two fields rather than one, because that is how the position is said aloud:
 * "bar 12, beat 3". Beat takes a decimal so an off-beat note can still be
 * stated exactly — a swung eighth is beat 2.5 — and the domain clamps a beat
 * past the end of its bar rather than rejecting it.
 *
 * Drafted and committed on blur, like every other typed field here: committing
 * per keystroke would move the note through every intermediate number.
 */
function BarBeatField({
  score,
  tick,
  onCommit,
}: {
  score: Score;
  tick: number;
  onCommit: (tick: number) => void;
}) {
  const { t } = useTranslation();
  const position = barBeatForTick(score, tick);
  // Pulled out as primitives: the effect below must re-run when the *values*
  // change, and `position` is a fresh object every render.
  const bar = position?.bar ?? null;
  // Two decimals is enough for any grid the editor offers, and trailing zeroes
  // on a whole beat read as noise.
  const beat = position ? Math.round(position.beat * 100) / 100 : null;

  const [barDraft, setBarDraft] = useState('');
  const [beatDraft, setBeatDraft] = useState('');

  useEffect(() => {
    setBarDraft(bar === null ? '' : String(bar));
    setBeatDraft(beat === null ? '' : String(beat));
  }, [bar, beat]);

  if (!position) return null;

  const commit = (bar: string, beat: string): void => {
    const barNumber = Number(bar);
    const beatNumber = Number(beat);
    if (!Number.isFinite(barNumber) || !Number.isFinite(beatNumber)) return;
    const next = tickForBarBeat(score, barNumber, beatNumber);
    if (next !== null && next !== tick) onCommit(next);
  };

  return (
    <div className="flex gap-2">
      <label className="flex flex-1 flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('editor.bar')}</span>
        <Input
          value={barDraft}
          inputMode="numeric"
          aria-label={t('editor.bar')}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setBarDraft(e.target.value)}
          onBlur={() => commit(barDraft, beatDraft)}
          className={TEXT_INPUT_CLASS}
        />
      </label>
      <label className="flex flex-1 flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('editor.beat')}</span>
        <Input
          value={beatDraft}
          inputMode="decimal"
          aria-label={t('editor.beat')}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setBeatDraft(e.target.value)}
          onBlur={() => commit(barDraft, beatDraft)}
          className={TEXT_INPUT_CLASS}
        />
      </label>
    </div>
  );
}

function CommitSlider({
  label,
  rowLabel,
  value,
  onCommit,
  kind,
  disabled,
}: {
  /** The accessible name, which says which track property this is. */
  label: string;
  /** The visible text in the row's label column. */
  rowLabel: string;
  value: number;
  onCommit: (value: number) => void;
  kind: 'volume' | 'pan';
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const resetLabel = t('track.centerPan');

  /**
   * Commits whatever the slider was left at.
   *
   * Guarded on the target being the range input itself, because this wrapper
   * commits on *any* pointer-up inside it and the pan row now carries a reset
   * button. A `<button>`'s `.value` is `''`, and `Number('')` is `0` — so an
   * unguarded handler silently commits zero for whatever the row controls.
   * On the pan row that happens to be what centring wants, which is precisely
   * why it would go unnoticed; the same button on the volume row would mute
   * the track. The reset commits through `onReset` instead, which says 0
   * because it means 0.
   */
  const commit = (e: ReactPointerEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.type !== 'range') return;
    onCommit(Number(target.value));
  };

  return (
    <div onPointerUp={commit} onKeyUp={commit}>
      {kind === 'volume' ? (
        <VolumeSlider
          label={label}
          rowLabel={rowLabel}
          value={draft}
          disabled={disabled}
          onChange={setDraft}
        />
      ) : (
        <PanSlider
          label={label}
          rowLabel={rowLabel}
          value={draft}
          disabled={disabled}
          onChange={setDraft}
          resetLabel={resetLabel}
          onReset={() => {
            // Straight to the store rather than through `commit`: the button
            // is not the range input, and centring is a decision rather than
            // the end of a drag.
            setDraft(0);
            onCommit(0);
          }}
        />
      )}
    </div>
  );
}

type TabProps = {
  store: EditorStoreApi;
  onReplace?: (scope: ReplaceScope, submission: ReplaceSubmission) => void;
};

/** The measure holding `note`, found by its track and tick, for the key signature. */
function measureOfNote(score: Score, note: NoteEvent): Measure | null {
  const track = findTrack(score, note.trackId);
  return (
    track?.measures.find(
      (m) => note.startTick >= m.startTick && note.startTick < m.startTick + m.durationTicks,
    ) ?? null
  );
}

function NoteTab({ store, onReplace }: TabProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const pitchDisplay = store((s) => s.pitchDisplay);
  // Content is immutable while the transport plays; these write notes.
  const isPlayingNow = store((s) => s.state === 'playing');

  if (!score)
    return <p className="p-2 text-sm text-theme-text-primary">{t('inspector.noScore')}</p>;
  const noteIds = selectedNoteIds(score, selection);
  const notes = noteIds
    .map((id) => findEvent(score, id))
    .filter((e): e is NoteEvent => e !== null && isNoteEvent(e));

  if (notes.length === 0) {
    return <p className="p-2 text-sm text-theme-text-secondary">{t('inspector.selectNote')}</p>;
  }

  /**
   * The pitch as the reader sees it: sounding in concert mode, and the
   * player's own written pitch otherwise. Zero shift for a non-transposing
   * instrument, so the common path returns the stored object untouched.
   */
  const shown = (note: NoteEvent): Pitch => {
    // Track-aware: a drum track's program is a kit, and kits 24 and 25 sit at
    // guitar programs, which transpose by an octave.
    const track = findTrack(score, note.trackId);
    const semitones = pitchDisplay === 'written' && track ? trackWrittenTransposition(track) : 0;
    if (semitones === 0) return note.pitch;
    const key = measureOfNote(score, note)?.keySignature ?? { fifths: 0, mode: 'major' };
    return transposePitch(note.pitch, semitones, transposeKeySignature(key, semitones));
  };

  const step = commonValue(notes.map((n) => shown(n).step));
  const accidentalStr = commonValue(notes.map((n) => String(shown(n).accidental)));
  const octave = commonValue(notes.map((n) => shown(n).octave));
  const durationTicks = commonValue(notes.map((n) => n.durationTicks));
  const startTick = commonValue(notes.map((n) => n.startTick));
  const velocity = commonValue(notes.map((n) => n.velocity));
  const articulation = commonValue(notes.map((n) => n.articulation ?? 'none'));
  const dynamic = commonValue(notes.map((n) => n.dynamic ?? NO_DYNAMIC));
  const trackName = commonValue(notes.map((n) => findTrack(score, n.trackId)?.name ?? '?'));
  const tieStart = commonValue(notes.map((n) => n.tieStart ?? false));
  const tieStop = commonValue(notes.map((n) => n.tieStop ?? false));

  const applyPitchPatch = (
    patch: Partial<{ step: PitchStep; accidental: Accidental; octave: number }>,
  ): void => {
    for (const note of notes) {
      // The patch is against what the user is *reading*, so apply it there and
      // convert once. Never a round trip: the stored pitch is replaced
      // outright, not fed back through the lens.
      const edited = { ...shown(note), ...patch };
      const track = findTrack(score, note.trackId);
      const key = measureOfNote(score, note)?.keySignature ?? { fifths: 0, mode: 'major' };
      const next =
        pitchDisplay === 'written' && track ? soundingPitchForTrack(edited, track, key) : edited;
      store
        .getState()
        .dispatchCommand(changePitchCommand([note.id], next, commandLabel('changePitch')));
    }
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      <p className="text-sm font-semibold text-theme-text-primary">
        {notes.length > 1
          ? t('inspector.notesSelected', { count: notes.length })
          : t('inspector.note')}
      </p>

      <div className="flex gap-2">
        <MixedSelect
          value={step}
          ariaLabel="Pitch step"
          options={PITCH_STEPS.map((s) => ({ value: s, label: s }))}
          onChange={(value) => applyPitchPatch({ step: value })}
        />
        <MixedSelect
          value={accidentalStr}
          ariaLabel="Accidental"
          options={ACCIDENTALS.map((a) => ({ value: String(a.value), label: a.label }))}
          onChange={(value) => dispatchAccidental(store, Number(value) as Accidental)}
        />
        <MixedNumberField
          label={t('editor.octave')}
          value={octave}
          onCommit={(v) => applyPitchPatch({ octave: v })}
        />
      </div>

      {/*
        A note value, not a tick count. The ticks are what the score stores;
        "480" is not what the reader is looking at. `durationNameForTicks`
        answers null for a length no single notehead spells — a tie join or an
        import can produce one — and the picker says so rather than relabelling
        it as the nearest name.
      */}
      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('editor.duration')}</span>
        <MixedSelect
          value={
            durationTicks === MIXED
              ? MIXED
              : durationTicks === null
                ? null
                : (durationNameForTicks(durationTicks, score.ppq) ?? CUSTOM_DURATION)
          }
          ariaLabel={t('editor.duration')}
          options={[
            ...DURATION_NAMES.map((name) => ({ value: name, label: durationLabel(name) })),
            ...(durationTicks !== MIXED &&
            durationTicks !== null &&
            durationNameForTicks(durationTicks, score.ppq) === null
              ? [
                  {
                    value: CUSTOM_DURATION,
                    label: t('editor.customDuration', { ticks: durationTicks }),
                  },
                ]
              : []),
          ]}
          onChange={(value) => {
            if (value === CUSTOM_DURATION) return;
            store
              .getState()
              .dispatchCommand(
                resizeNotesCommand(
                  noteIds,
                  ticksFor(value as DurationName, score.ppq),
                  commandLabel('resizeNotes'),
                ),
              );
          }}
        />
      </label>

      {/*
        Where the note sits, counted the way a player counts: bar 1 upwards,
        beat 1 upwards. Still editable — typing a bar or a beat moves the note —
        because stating a position exactly is the reason to have this field at
        all, and a read-only readout would have removed an editor.
      */}
      {notes.length === 1 && startTick !== MIXED && startTick !== null ? (
        <BarBeatField
          score={score}
          tick={startTick}
          onCommit={(tick) =>
            store
              .getState()
              .dispatchCommand(
                moveNotesCommand(
                  [notes[0].id],
                  { deltaTicks: tick - notes[0].startTick, deltaSemitones: 0 },
                  commandLabel('moveNotes'),
                ),
              )
          }
        />
      ) : null}

      <MixedNumberField
        label={t('editor.velocity')}
        value={velocity}
        min={0}
        max={127}
        onCommit={(v) => dispatchVelocity(store, Math.max(0, Math.min(127, Math.round(v))))}
      />

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.articulation')}</span>
        <MixedSelect
          value={articulation}
          ariaLabel="Articulation"
          options={ARTICULATIONS.map((a) => ({ value: a.value, label: t(a.labelKey) }))}
          onChange={(value) => dispatchArticulation(store, value === 'none' ? undefined : value)}
        />
      </label>

      {/*
        The dynamic this note *starts*. It governs until the next marking on
        the track, so it is set on the note a level begins at rather than on
        every note in the passage — which is why the hint says "from here".
      */}
      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.dynamic')}</span>
        <MixedSelect
          value={dynamic}
          ariaLabel={t('inspector.dynamic')}
          options={[
            { value: NO_DYNAMIC, label: t('inspector.noDynamic') },
            ...DYNAMICS.map((d) => ({ value: d, label: d })),
          ]}
          onChange={(value) =>
            store
              .getState()
              .dispatchCommand(
                changeDynamicCommand(
                  noteIds,
                  value === NO_DYNAMIC ? undefined : (value as Dynamic),
                  commandLabel('changeDynamic'),
                ),
              )
          }
        />
        <span className="text-xs text-theme-text-secondary">{t('inspector.dynamicHint')}</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.track')}</span>
        <Input
          value={trackName === MIXED ? '' : (trackName ?? '')}
          placeholder={trackName === MIXED ? t('inspector.mixed') : undefined}
          disabled
          aria-label={t('editor.trackReadOnly')}
          className={TEXT_INPUT_CLASS}
          readOnly
        />
      </label>

      <MixedNumberField
        label={t('editor.voice')}
        value={commonValue(
          notes.map((n) => {
            const measure = score.tracks
              .flatMap((t) => t.measures)
              .find((m) => m.voices.some((v) => v.id === n.voiceId));
            // Counted from 1, matching the toolbar's own Voice 1 / Voice 2
            // buttons. The same note used to read as "Voice 1" on the bar and
            // "0" here.
            return (measure ? measure.voices.findIndex((v) => v.id === n.voiceId) : 0) + 1;
          }),
        )}
        min={1}
        onCommit={(v) =>
          store
            .getState()
            .dispatchCommand(
              changeVoiceCommand(
                noteIds,
                Math.max(0, Math.round(v) - 1),
                commandLabel('changeVoice'),
              ),
            )
        }
      />

      <div className="flex gap-4">
        <MixedCheckbox
          label={t('editor.tieStart')}
          checked={tieStart === true}
          indeterminate={tieStart === MIXED}
          onChange={() => dispatchToggleTie(store, 'tieStart')}
        />
        <MixedCheckbox
          label={t('editor.tieStop')}
          checked={tieStop === true}
          indeterminate={tieStop === MIXED}
          onChange={() => dispatchToggleTie(store, 'tieStop')}
        />
      </div>

      {/*
        An ornament belongs to the note after it, so this is offered for one
        selected note and the command decides which note that is. A note with
        nothing after it cannot become one — an ornament with nothing to
        ornament would vanish from the page — so the command refuses and this
        stays enabled rather than guessing at the rule.
      */}
      {notes.length === 1 ? (
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="outline"
            disabled={isPlayingNow}
            onClick={() =>
              store
                .getState()
                .dispatchCommand(toGraceNoteCommand(notes[0].id, commandLabel('toGraceNote')))
            }
            className="w-full px-3 py-1.5 text-sm"
          >
            {t('editor.makeGraceNote')}
          </Button>
          {notes[0].graceNotes?.length ? (
            <Button
              type="button"
              variant="ghost"
              disabled={isPlayingNow}
              onClick={() =>
                store
                  .getState()
                  .dispatchCommand(
                    clearGraceNotesCommand([notes[0].id], commandLabel('toGraceNote')),
                  )
              }
              className="w-full px-3 py-1 text-xs"
            >
              {t('editor.clearGraceNotes', { count: notes[0].graceNotes.length })}
            </Button>
          ) : null}
        </div>
      ) : null}

      <ReplaceButton
        store={store}
        scope="notes"
        label={t('editor.replaceNotes')}
        onReplace={onReplace}
      />
    </div>
  );
}

function MeasureTab({ store, onReplace }: TabProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);

  if (!score)
    return <p className="p-2 text-sm text-theme-text-primary">{t('inspector.noScore')}</p>;
  const measures = selection.measureIds
    .map((id) => findMeasure(score, id))
    .filter((m) => m !== null);

  if (measures.length === 0) {
    return (
      <div className="flex flex-col gap-1 p-2">
        <p className="text-sm text-theme-text-secondary">{t('inspector.selectMeasure')}</p>
        <p className="text-xs text-theme-text-secondary">{t('inspector.selectMeasureHint')}</p>
      </div>
    );
  }

  const timeSig = commonValue(measures.map((m) => m.timeSignature));
  const keySig = commonValue(measures.map((m) => m.keySignature));
  const indices = measures.map((m) => m.index + 1);

  const applyTimeSignature = (timeSignature: TimeSignature): void => {
    for (const id of selection.measureIds)
      store
        .getState()
        .dispatchCommand(
          changeTimeSignatureCommand(id, timeSignature, commandLabel('changeTimeSignature')),
        );
  };
  const applyKeySignature = (keySignature: KeySignature): void => {
    for (const id of selection.measureIds)
      store
        .getState()
        .dispatchCommand(
          changeKeySignatureCommand(id, keySignature, commandLabel('changeKeySignature')),
        );
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      <p className="text-sm font-semibold text-theme-text-primary">
        {measures.length > 1
          ? t('inspector.measureRange', {
              from: Math.min(...indices),
              to: Math.max(...indices),
            })
          : t('inspector.measureNumber', { number: indices[0] })}
      </p>

      <div className="flex gap-2">
        <MixedNumberField
          label={t('editor.timeSigNumerator')}
          value={timeSig === MIXED ? MIXED : (timeSig?.numerator ?? null)}
          min={1}
          onCommit={(v) =>
            applyTimeSignature({
              numerator: Math.max(1, Math.round(v)),
              denominator: timeSig !== MIXED ? (timeSig?.denominator ?? 4) : 4,
            })
          }
        />
        <MixedNumberField
          label={t('editor.timeSigDenominator')}
          value={timeSig === MIXED ? MIXED : (timeSig?.denominator ?? null)}
          min={1}
          onCommit={(v) =>
            applyTimeSignature({
              numerator: timeSig !== MIXED ? (timeSig?.numerator ?? 4) : 4,
              denominator: Math.max(1, Math.round(v)),
            })
          }
        />
      </div>

      <div className="flex gap-2">
        {/*
          A key, named. "Key (fifths) 2" is the storage format; the reader is
          looking at D major. The options follow the chosen mode, because two
          sharps is D major or B minor depending on it.
        */}
        <MixedSelect
          value={keySig === MIXED ? MIXED : keySig ? String(keySig.fifths) : null}
          ariaLabel={t('editor.key')}
          options={keySignatureOptions(keySig !== MIXED ? (keySig?.mode ?? 'major') : 'major').map(
            (option) => ({ value: String(option.fifths), label: option.label }),
          )}
          onChange={(value) =>
            applyKeySignature({
              fifths: Number(value),
              mode: keySig !== MIXED ? (keySig?.mode ?? 'major') : 'major',
            })
          }
        />
        <MixedSelect
          value={keySig === MIXED ? MIXED : (keySig?.mode ?? null)}
          ariaLabel="Key mode"
          options={[
            { value: 'major', label: 'major' },
            { value: 'minor', label: 'minor' },
          ]}
          onChange={(value) =>
            applyKeySignature({
              fifths: keySig !== MIXED ? (keySig?.fifths ?? 0) : 0,
              mode: value as KeySignature['mode'],
            })
          }
        />
      </div>

      {/*
        A tempo change at this bar. The transport's own BPM field always edits
        `tempoMap[0]` — the score's starting tempo — so before this there was no
        way to say "faster from bar 33", even though `tempoMap` is an array and
        the command has always taken a tick.

        Offered for a single measure only: writing one tempo across a
        multi-measure selection would mean one event per bar, which is not what
        a tempo change is.
      */}
      {measures.length === 1 ? (
        <MeasureTempoField store={store} score={score} measure={measures[0]} />
      ) : null}

      <ReplaceButton
        store={store}
        scope="measures"
        label={t('editor.replaceMeasures')}
        onReplace={onReplace}
      />
    </div>
  );
}

/**
 * The selected track's properties.
 *
 * Reflects and invokes, and does neither of those things twice: the track it
 * shows comes from `selectSelectedTrack`, and every edit is a `track-slice`
 * action. What used to be decided here — that a percussion program addresses a
 * kit, that the instrument name must move with the program, that changing
 * instrument carries the notes into the new compass, that the last track
 * cannot go — are rules about a score, so they live in `music_lib` where the
 * one implementation serves this panel and anything else that edits a track.
 */
function TrackTab({ store, onReplace }: TabProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const track = store(selectSelectedTrack);
  /**
   * Content editing is refused while the transport plays (`score-slice`'s edit
   * lock), so name, instrument, kit, clef and delete say so rather than looking
   * live and doing nothing.
   *
   * Mute, solo, volume and pan stay enabled: they are mixing, not editing, and
   * they reach the engine live through `applyMix`. Mixing while listening is
   * the point.
   */
  const isPlaying = store((s) => s.state === 'playing');
  const canDelete = store((s) => s.canDeleteTrack());
  const [pendingDelete, setPendingDelete] = useState(false);

  // Local draft so typing does not dispatch a command per keystroke — which
  // would put one undo entry on the history per character. Committed on blur,
  // and reset whenever the track changes underneath us.
  const [nameDraft, setNameDraft] = useState(track?.name ?? '');
  useEffect(() => {
    setNameDraft(track?.name ?? '');
  }, [track?.id, track?.name]);

  if (!score)
    return <p className="p-2 text-sm text-theme-text-primary">{t('inspector.noScore')}</p>;

  if (!track) {
    return <p className="p-2 text-sm text-theme-text-secondary">{t('inspector.selectTrack')}</p>;
  }

  const chooseInstrument = (value: string): void => {
    const result = store
      .getState()
      .setTrackInstrument(track.id, value, commandLabel('changeTrackProps'));
    // The one outcome the panel has words for: the part is wider than the
    // instrument can play, so nothing was changed.
    if (!result.ok && result.reason === 'outOfRange')
      store.getState().pushToast({
        message: t('track.instrumentRangeError', { instrument: result.instrumentName }),
        severity: 'error',
      });
  };

  const mix = (patch: TrackMixPatch): void => {
    store.getState().setTrackMix(track.id, patch, commandLabel('changeTrackProps'));
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      <p className="text-sm font-semibold text-theme-text-primary">{t('inspector.track')}</p>

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.name')}</span>
        <Input
          value={nameDraft}
          disabled={isPlaying}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNameDraft(e.target.value)}
          onBlur={() => {
            if (nameDraft.trim() === track.name) return;
            store.getState().renameTrack(track.id, nameDraft, commandLabel('changeTrackProps'));
            setNameDraft(track.name);
          }}
          aria-label={t('editor.trackName')}
          className={TEXT_INPUT_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('generate.instrument')}</span>
        <div className="flex items-center gap-1">
          <InstrumentIcon track={track} className="size-4 shrink-0" />
          {/*
            A picker, never a text field, and two lists rather than one: a
            percussion track's program addresses a *kit*, so the melodic
            catalogue would name the wrong thing. Which list is showing is the
            only difference here — `setTrackInstrument` takes the value either
            one produces and resolves it.
          */}
          {isPercussionTrack(track) ? (
            <SheetSelector
              title={t('track.drumKit')}
              aria-label={t('track.kitOf', { name: track.name })}
              disabled={isPlaying}
              options={KIT_OPTIONS}
              value={kitOptionValue(track.midiProgram)}
              onChange={chooseInstrument}
              size="large"
              className={`${FIELD_HEIGHT_CLASS} w-full justify-between px-2 py-1.5 text-sm`}
            />
          ) : (
            <SheetSelector
              title={t('generate.instrument')}
              aria-label={t('generate.instrument')}
              disabled={isPlaying}
              options={INSTRUMENT_OPTIONS}
              value={String(track.midiProgram)}
              onChange={chooseInstrument}
              size="large"
              className={`${FIELD_HEIGHT_CLASS} w-full justify-between px-2 py-1.5 text-sm`}
            />
          )}
        </div>
      </label>

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('importMidi.colClef')}</span>
        <MixedSelect
          value={track.clef}
          ariaLabel="Track clef"
          disabled={isPlaying}
          options={CLEFS.map((c) => ({ value: c, label: c }))}
          onChange={(value) =>
            store.getState().setTrackClef(track.id, value as Clef, commandLabel('changeClef'))
          }
        />
      </label>

      <CommitSlider
        label={t('editor.trackVolume')}
        rowLabel={t('inspector.volume')}
        value={track.volume}
        onCommit={(v) => mix({ volume: v })}
        kind="volume"
      />
      <CommitSlider
        label={t('editor.trackPan')}
        rowLabel={t('track.pan')}
        value={track.pan}
        onCommit={(v) => mix({ pan: v })}
        kind="pan"
      />

      <div className="flex gap-4">
        <MixedCheckbox
          label={t('editor.muted')}
          checked={track.muted === true}
          onChange={(checked) => mix({ muted: checked })}
        />
        <MixedCheckbox
          label={t('editor.solo')}
          checked={track.solo === true}
          onChange={(checked) => mix({ solo: checked })}
        />
      </div>

      <ReplaceButton
        store={store}
        scope="track"
        label={t('editor.replaceTrack')}
        onReplace={onReplace}
      />

      {/*
        Destructive, and confirmed: deleting a track takes its music with it,
        and unlike a note there is no visible remnant to hint at what was lost.
        `canDeleteTrack` is the store's own rule, asked rather than restated.
      */}
      <Button
        type="button"
        variant="destructive"
        onClick={() => setPendingDelete(true)}
        disabled={!canDelete || isPlaying}
        aria-label={t('editor.deleteTrack')}
      >
        {t('editor.deleteTrack')}
      </Button>

      <ConfirmDialog
        open={pendingDelete}
        title={t('editor.deleteTrack')}
        message={t('editor.deleteTrackConfirm', { name: track.name })}
        confirmLabel={t('editor.deleteTrack')}
        destructive
        onConfirm={() => {
          setPendingDelete(false);
          store.getState().removeTrack(track.id, commandLabel('deleteTrack'));
        }}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}

/**
 * The tempo in force at a measure, and whether this measure sets it.
 *
 * Shows the tempo a player would count here — inherited from an earlier event
 * when this bar sets none — so the field is never blank and never lies. Typing
 * a value writes an event at this bar's tick; Remove is offered only when the
 * event is this bar's own, since the starting tempo is not a change and
 * removing it would leave the score with no tempo at all.
 */
function MeasureTempoField({
  store,
  score,
  measure,
}: {
  store: EditorStoreApi;
  score: Score;
  measure: Measure;
}) {
  const { t } = useTranslation();
  const isPlaying = store((s) => s.state === 'playing');

  const ownEvent = score.tempoMap.find((e) => e.tick === measure.startTick);
  const inForce = [...score.tempoMap]
    .sort((a, b) => a.tick - b.tick)
    .filter((e) => e.tick <= measure.startTick)
    .at(-1);
  const isFirst = score.tempoMap[0]?.id === ownEvent?.id;

  const [draft, setDraft] = useState('');
  useEffect(() => {
    setDraft(String(Math.round(inForce?.bpm ?? 120)));
  }, [inForce?.bpm, measure.id]);

  const commit = (): void => {
    const bpm = Math.round(Number(draft));
    if (!Number.isFinite(bpm) || bpm <= 0) {
      setDraft(String(Math.round(inForce?.bpm ?? 120)));
      return;
    }
    if (ownEvent && bpm === Math.round(ownEvent.bpm)) return;
    store
      .getState()
      .dispatchCommand(
        changeTempoCommand(
          { tempoEventId: ownEvent?.id, tick: measure.startTick, bpm },
          commandLabel('changeTempo'),
        ),
      );
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('editor.tempoHere')}</span>
        <Input
          value={draft}
          inputMode="numeric"
          disabled={isPlaying}
          aria-label={t('editor.tempoHere')}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
          onBlur={commit}
          className={TEXT_INPUT_CLASS}
        />
      </label>
      {ownEvent && !isFirst ? (
        <Button
          type="button"
          variant="ghost"
          disabled={isPlaying}
          onClick={() =>
            store
              .getState()
              .dispatchCommand(removeTempoCommand(ownEvent.id, commandLabel('changeTempo')))
          }
          className="self-start px-1 py-0.5 text-xs"
        >
          {t('editor.removeTempoChange')}
        </Button>
      ) : (
        <span className="text-xs text-theme-text-secondary">
          {ownEvent ? t('editor.tempoStarting') : t('editor.tempoInherited')}
        </span>
      )}
    </div>
  );
}

/**
 * The score's own title and composer.
 *
 * Distinct from the project name in the title bar, which names the row the
 * score is stored in. This is what travels with the music: it names every
 * exported file and fills MusicXML's work title. Nothing could edit it before,
 * so a project renamed after creation kept exporting under whatever its
 * template was called — rename "String Quartet" to "Wedding March", export,
 * and the file was still String Quartet.mid. Composer had no path at all,
 * which left every exported and published score anonymous.
 */
function ScoreTab({ store }: { store: EditorStoreApi }) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const isPlaying = store((s) => s.state === 'playing');

  const [title, setTitle] = useState(score?.metadata.title ?? '');
  const [composer, setComposer] = useState(score?.metadata.composer ?? '');

  useEffect(() => {
    setTitle(score?.metadata.title ?? '');
    setComposer(score?.metadata.composer ?? '');
  }, [score?.metadata.title, score?.metadata.composer]);

  if (!score)
    return <p className="p-2 text-sm text-theme-text-primary">{t('inspector.noScore')}</p>;

  const commit = (patch: { title?: string; composer?: string }): void => {
    store.getState().setScoreMetadata(patch, commandLabel('changeMetadata'));
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      <p className="text-sm font-semibold text-theme-text-primary">{t('inspector.score')}</p>

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.scoreTitle')}</span>
        <Input
          value={title}
          disabled={isPlaying}
          aria-label={t('inspector.scoreTitle')}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() === score.metadata.title) return;
            commit({ title });
            setTitle(score.metadata.title);
          }}
          className={TEXT_INPUT_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.composer')}</span>
        <Input
          value={composer}
          disabled={isPlaying}
          aria-label={t('inspector.composer')}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setComposer(e.target.value)}
          onBlur={() => {
            if (composer.trim() === (score.metadata.composer ?? '')) return;
            commit({ composer });
          }}
          className={TEXT_INPUT_CLASS}
        />
      </label>

      <p className="text-xs text-theme-text-secondary">{t('inspector.scoreTitleHint')}</p>
    </div>
  );
}

/** Which tab a fresh selection should default to: notes take priority, then measures, then tracks. */
function defaultTabFor(selection: {
  eventIds: string[];
  measureIds: string[];
  trackIds: string[];
}): InspectorTab {
  if (selection.eventIds.length > 0) return 'note';
  if (selection.measureIds.length > 0) return 'measure';
  if (selection.trackIds.length > 0) return 'track';
  // Nothing selected: the track tab always has content, where the others are
  // an empty-state message.
  return 'track';
}

/**
 * Track first: it is the only tab that always has something to show — there is
 * always an active track, where a note or measure tab is empty until you select
 * one — and it is now the only place tracks are edited at all.
 */
const TABS: Array<{ value: InspectorTab; labelKey: string }> = [
  { value: 'score', labelKey: 'inspector.score' },
  { value: 'track', labelKey: 'inspector.track' },
  { value: 'note', labelKey: 'inspector.note' },
  { value: 'measure', labelKey: 'inspector.measure' },
];

export function InspectorPanel({ store = useAppStore, onReplace }: InspectorPanelProps) {
  const { t } = useTranslation();
  const selection = store((s) => s.selection);
  const [tab, setTab] = useState<InspectorTab>(() => defaultTabFor(selection));

  // Re-derive the default tab whenever the selection's *kind* changes (a
  // fresh note/measure/track click), without fighting the user's own tab
  // clicks in between (only runs off `selection`, not `tab`).
  useEffect(() => {
    setTab(defaultTabFor(selection));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.eventIds, selection.measureIds, selection.trackIds]);

  return (
    <div className="flex h-full flex-col overflow-auto" aria-label={t('editor.inspectorPanel')}>
      <Tabs value={tab} onValueChange={(value) => setTab(value as InspectorTab)}>
        <TabsList aria-label={t('editor.inspectorTabs')}>
          {/* Not `t` as the parameter name: it would shadow the translation
              function this now calls. */}
          {TABS.map((tab_) => (
            <TabsTrigger key={tab_.value} value={tab_.value}>
              {t(tab_.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="score">
          <ScoreTab store={store} />
        </TabsContent>
        <TabsContent value="note">
          <NoteTab store={store} onReplace={onReplace} />
        </TabsContent>
        <TabsContent value="measure">
          <MeasureTab store={store} onReplace={onReplace} />
        </TabsContent>
        <TabsContent value="track">
          <TrackTab store={store} onReplace={onReplace} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
