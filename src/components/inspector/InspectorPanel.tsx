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
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@sudobility/components';
import type {
  Accidental,
  Articulation,
  Clef,
  KeySignature,
  Measure,
  NoteEvent,
  Pitch,
  PitchStep,
  Score,
  TimeSignature,
} from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
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
} from '@sudobility/music_lib';
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
  changeClefCommand,
  changeKeySignatureCommand,
  changeTimeSignatureCommand,
  changeTrackPropsCommand,
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

type InspectorTab = 'note' | 'measure' | 'track';

const FIELD_LABEL_CLASS = 'text-xs text-theme-text-secondary';
const TEXT_INPUT_CLASS = 'w-full px-2 py-1.5 text-sm';
const SELECT_CLASS = 'h-auto w-full justify-between px-2 py-1.5 text-sm';

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
  indeterminate: boolean;
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

      <MixedNumberField
        label={t('editor.durationTicks')}
        value={durationTicks}
        min={1}
        onCommit={(v) =>
          store
            .getState()
            .dispatchCommand(
              resizeNotesCommand(noteIds, Math.max(1, Math.round(v)), commandLabel('resizeNotes')),
            )
        }
      />

      <MixedNumberField
        label={t('editor.startTicks')}
        value={notes.length === 1 ? startTick : null}
        min={0}
        onCommit={(v) => {
          if (notes.length !== 1) return;
          const note = notes[0];
          store
            .getState()
            .dispatchCommand(
              moveNotesCommand(
                [note.id],
                { deltaTicks: v - note.startTick, deltaSemitones: 0 },
                commandLabel('moveNotes'),
              ),
            );
        }}
      />

      <MixedNumberField
        label={t('editor.velocity')}
        value={velocity}
        min={0}
        max={127}
        onCommit={(v) => dispatchVelocity(store, Math.max(0, Math.min(127, Math.round(v))))}
      />

      <MixedSelect
        value={articulation}
        ariaLabel="Articulation"
        options={ARTICULATIONS.map((a) => ({ value: a.value, label: t(a.labelKey) }))}
        onChange={(value) => dispatchArticulation(store, value === 'none' ? undefined : value)}
      />

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
            return measure ? measure.voices.findIndex((v) => v.id === n.voiceId) : 0;
          }),
        )}
        min={0}
        onCommit={(v) =>
          store
            .getState()
            .dispatchCommand(
              changeVoiceCommand(noteIds, Math.max(0, Math.round(v)), commandLabel('changeVoice')),
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
    return <p className="p-2 text-sm text-theme-text-secondary">{t('inspector.selectMeasure')}</p>;
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
        <MixedNumberField
          label={t('editor.keyFifths')}
          value={keySig === MIXED ? MIXED : (keySig?.fifths ?? null)}
          min={-7}
          max={7}
          onCommit={(v) =>
            applyKeySignature({
              fifths: Math.round(v),
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

      <ReplaceButton
        store={store}
        scope="measures"
        label={t('editor.replaceMeasures')}
        onReplace={onReplace}
      />
    </div>
  );
}

function TrackTab({ store, onReplace }: TabProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const activeTrackId = store(selectActiveTrackId);

  /**
   * Follows the **active** track, not `selection.trackIds`.
   *
   * Clicking the track gutter sets both, but any later click on a note or the
   * stave replaces the whole selection and wipes `trackIds` — so the panel
   * emptied as soon as you touched the music you were inspecting. The active
   * track is sticky, and `selectActiveTrackId` falls back to the first track
   * when it is unset or stale, so there is always exactly one to show.
   *
   * Kept as an array so the multi-value rendering below is unchanged; in
   * practice it now always holds one, as it always did — nothing ever put
   * more than one id in `selection.trackIds`.
   *
   * Computed unconditionally (rather than after the "no score" early return
   * below) so the volume/pan drag-draft hooks just below can be called
   * unconditionally too, per the rules of hooks.
   */
  const active = score && activeTrackId ? findTrack(score, activeTrackId) : null;
  const tracks = active ? [active] : [];
  const volume = commonValue(tracks.map((t) => t.volume));
  const pan = commonValue(tracks.map((t) => t.pan));

  if (!score)
    return <p className="p-2 text-sm text-theme-text-primary">{t('inspector.noScore')}</p>;

  if (tracks.length === 0) {
    return <p className="p-2 text-sm text-theme-text-secondary">{t('inspector.selectTrack')}</p>;
  }

  const name = commonValue(tracks.map((t) => t.name));
  const clef = commonValue(tracks.map((t) => t.clef));
  const muted = commonValue(tracks.map((t) => t.muted));
  const solo = commonValue(tracks.map((t) => t.solo));

  const patchAll = (patch: Record<string, unknown>): void => {
    for (const t of tracks)
      store
        .getState()
        .dispatchCommand(changeTrackPropsCommand(t.id, patch, commandLabel('changeTrackProps')));
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      <p className="text-sm font-semibold text-theme-text-primary">
        {tracks.length > 1
          ? t('inspector.tracksSelected', { count: tracks.length })
          : t('inspector.track')}
      </p>

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.name')}</span>
        <Input
          value={name === MIXED ? '' : (name ?? '')}
          placeholder={name === MIXED ? t('inspector.mixed') : undefined}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patchAll({ name: e.target.value })}
          aria-label={t('editor.trackName')}
          className={TEXT_INPUT_CLASS}
        />
      </label>
      {/* No instrument here. It is set in `TrackEditorPanel`'s catalogue
          picker, which is the only place that can keep `midiProgram` and
          `instrumentName` in step — and on a percussion track resolve the
          program as a *kit* rather than an instrument. A free-text field here
          set the name alone, so the two drifted: the label read "Piano" while
          the track still sounded whatever program it had.

          The MIDI program and channel numbers went with it. Program was the
          same value the picker owns, editable as a raw number with none of the
          kit handling; channel was written but never read, since playback
          allocates channels itself (`allocateChannels`). */}
      <MixedSelect
        value={clef}
        ariaLabel="Track clef"
        options={CLEFS.map((c) => ({ value: c, label: c }))}
        onChange={(value) => {
          for (const t of tracks)
            store
              .getState()
              .dispatchCommand(changeClefCommand(t.id, value as Clef, commandLabel('changeClef')));
        }}
      />

      <div className="flex items-center gap-2">
        <span className="min-w-[40px] text-xs text-theme-text-secondary">
          {t('inspector.volume')}
        </span>
        <CommitSlider
          label={t('editor.trackVolume')}
          value={volume === MIXED || volume === null ? 1 : volume}
          onCommit={(v) => patchAll({ volume: v })}
          min={0}
          max={1}
          step={0.01}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="min-w-[40px] text-xs text-theme-text-secondary">Pan</span>
        <CommitSlider
          label={t('editor.trackPan')}
          value={pan === MIXED || pan === null ? 0 : pan}
          onCommit={(v) => patchAll({ pan: v })}
          min={-1}
          max={1}
          step={0.01}
        />
      </div>

      <div className="flex gap-4">
        <MixedCheckbox
          label={t('editor.muted')}
          checked={muted === true}
          indeterminate={muted === MIXED}
          onChange={(checked) => patchAll({ muted: checked })}
        />
        <MixedCheckbox
          label={t('editor.solo')}
          checked={solo === true}
          indeterminate={solo === MIXED}
          onChange={(checked) => patchAll({ solo: checked })}
        />
      </div>

      <ReplaceButton
        store={store}
        scope="track"
        label={t('editor.replaceTrack')}
        onReplace={onReplace}
      />
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
  return 'note';
}

const TABS: Array<{ value: InspectorTab; labelKey: string }> = [
  { value: 'note', labelKey: 'inspector.note' },
  { value: 'measure', labelKey: 'inspector.measure' },
  { value: 'track', labelKey: 'inspector.track' },
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
