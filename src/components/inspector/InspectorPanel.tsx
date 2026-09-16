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
 * Every mutating field calls a `music_lib` editing facade — never an ad hoc
 * store write, and never a command factory imported into React.
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
import { GenerationChoices } from '@/features/generation/GenerationChoices';
import type { GenerationChoicesProps } from '@/features/generation/GenerationChoices';
import { commandLabel } from '@sudobility/music_lib';
import { outOfRangeNoteIds } from '@sudobility/music_types';
import { BarBeatField, ChordSymbolField, FingeringField } from '@/components/inspector/note-fields';
import {
  BarlineField,
  MeasureClefField,
  MeasureTempoField,
  NavigationFields,
  PickupField,
  RepeatFields,
} from '@/components/inspector/measure-fields';
import {
  CommitSlider,
  MixedCheckbox,
  MixedNumberField,
  MixedSelect,
} from '@/components/inspector/controls';
import {
  ACCIDENTAL_PICKER,
  FIELD_HEIGHT_CLASS,
  FIELD_LABEL_CLASS,
  MIXED,
  TEXT_INPUT_CLASS,
  commonValue,
} from '@/components/inspector/shared';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent } from 'react';
import {
  SheetSelector,
  Button,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  ToggleGroup,
} from '@sudobility/components';
import type {
  Accidental,
  Dynamic,
  Clef,
  KeySignature,
  KeySignatureOption,
  NoteEvent,
  Pitch,
  PitchStep,
  DurationName,
  TimeSignature,
} from '@sudobility/music_types';
import {
  ARTICULATION_OPTIONS,
  CLEF_OPTIONS,
  CUSTOM_DURATION,
  DYNAMIC_OPTIONS,
  KEY_MODE_OPTIONS,
  MAX_OCTAVE,
  MAX_TIME_SIG_NUMERATOR,
  MIN_OCTAVE,
  NO_MARK,
  PITCH_STEPS,
  TIME_SIG_DENOMINATOR_OPTIONS,
  barNumberAt,
  durationFieldState,
  instrumentPickerFor,
  isNoteEvent,
  isPercussionTrack,
  midiToPitch,
  pitchToString,
} from '@sudobility/music_types';
import {
  INSPECTOR_TABS,
  INSPECTOR_TAB_LABEL_KEY,
  canReplace,
  defaultInspectorTab,
  findEvent,
  findMeasure,
  findTrack,
  replacementRegion,
  estimateReplacementCredits,
  selectActiveTrackId,
  selectEditLocked,
  durationLabel,
  keySignatureOptions,
  noteTextFieldsVisible,
  DURATION_NAMES,
  selectSelectedTrack,
} from '@sudobility/music_lib';
import type { InspectorTab } from '@sudobility/music_lib';
import type { TrackMixPatch } from '@sudobility/music_lib';
import {
  changeAccidental as dispatchAccidental,
  changeArticulation as dispatchArticulation,
  changeVelocity as dispatchVelocity,
  selectedNoteIds,
  toggleTie as dispatchToggleTie,
  toggleGlissando,
  toggleOttava,
  setNotePitch,
  moveNoteToTick,
  setDynamic,
  resizeNotes,
  setVoice,
  toGraceNote,
  clearGraceNotes,
  setTimeSignature,
  setKeySignature,
  voiceNumberOf,
  displayedPitchForNote,
} from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@sudobility/music_lib';
import type { ReplaceScope } from '@sudobility/music_lib';
import { ReplaceMusicDialog } from '@/features/generation/ReplaceMusicDialog';
import type { ReplaceSubmission } from '@sudobility/music_lib';
import { OTTAVAS } from '@sudobility/music_types';

export type InspectorPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /**
   * Starts a replacement job. Omitted in isolation tests, where the buttons
   * still render and disable correctly but do nothing.
   */
  onReplace?: (scope: ReplaceScope, submission: ReplaceSubmission) => void;
  /**
   * The open project's last generation and how to run it again, shown on the
   * Score tab. Omitted where the project was never generated.
   */
  generation?: GenerationChoicesProps;
};

/**
 * The Replace button each tab carries, plus its modal.
 *
 * Disabled unless `canReplace` says so: there is a region to replace for that
 * scope (`replacementRegion`, the same region the job will use) and the
 * transport is not playing, since the result is written into the score.
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
  const available = store((s) => canReplace(s, scope));

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
        disabled={!available}
        onClick={() => setOpen(true)}
        className="w-full px-3 py-1.5 text-sm"
      >
        {label}
      </Button>
      <ReplaceMusicDialog
        open={open}
        scope={scope}
        region={region}
        estimatedCredits={score && region ? estimateReplacementCredits(score, region) : 0}
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

type TabProps = {
  store: EditorStoreApi;
  onReplace?: (scope: ReplaceScope, submission: ReplaceSubmission) => void;
};

function NoteTab({ store, onReplace }: TabProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const pitchDisplay = store((s) => s.pitchDisplay);
  /*
    Content is immutable while the transport plays, and every field on this tab
    writes notes — so the whole tab locks, not only the text fields (decision 4
    of the parity plan; the native Note tab does the same). The store refuses
    the edits regardless; a field that looks live and then does nothing is the
    worse half of that.
  */
  const locked = store(selectEditLocked);

  if (!score)
    return <p className="p-2 text-sm text-theme-text-primary">{t('inspector.noScore')}</p>;
  const noteIds = selectedNoteIds(score, selection);
  const notes = noteIds
    .map((id) => findEvent(score, id))
    .filter((e): e is NoteEvent => e !== null && isNoteEvent(e));

  if (notes.length === 0) {
    return <p className="p-2 text-sm text-theme-text-secondary">{t('inspector.selectNote')}</p>;
  }

  const shown = (note: NoteEvent): Pitch => displayedPitchForNote(score, note, pitchDisplay);

  const step = commonValue(notes.map((n) => shown(n).step));
  const accidentalStr = commonValue(notes.map((n) => String(shown(n).accidental)));
  const octave = commonValue(notes.map((n) => shown(n).octave));
  const duration = durationFieldState(notes, score.ppq);
  const startTick = commonValue(notes.map((n) => n.startTick));
  const velocity = commonValue(notes.map((n) => n.velocity));
  const articulation = commonValue(notes.map((n) => n.articulation ?? NO_MARK));
  const dynamic = commonValue(notes.map((n) => n.dynamic ?? NO_MARK));
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
      setNotePitch(store, note.id, edited, pitchDisplay);
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
          ariaLabel={t('inspector.pitchStep')}
          disabled={locked}
          options={PITCH_STEPS.map((s) => ({ value: s, label: s }))}
          onChange={(value) => applyPitchPatch({ step: value })}
        />
        <MixedSelect
          value={accidentalStr}
          ariaLabel={t('editor.accidental')}
          disabled={locked}
          options={ACCIDENTAL_PICKER.map((a) => ({ value: String(a.value), label: a.label }))}
          onChange={(value) => dispatchAccidental(store, Number(value) as Accidental)}
        />
        <MixedNumberField
          label={t('inspector.octave')}
          value={octave}
          min={MIN_OCTAVE}
          max={MAX_OCTAVE}
          disabled={locked}
          onCommit={(v) => applyPitchPatch({ octave: v })}
        />
      </div>

      {/*
        A note value, not a tick count. The ticks are what the score stores;
        "480" is not what the reader is looking at. `durationNameForTicks`
        answers null for a length no single notehead spells — a tie join or an
        import can produce one — and the picker says so rather than relabelling
        it as the nearest name. `durationFieldState` keeps a selection that
        agrees on such a length ("custom") apart from one that disagrees
        ("mixed").
      */}
      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.duration')}</span>
        <MixedSelect
          value={
            duration === null
              ? null
              : duration.kind === 'mixed'
                ? MIXED
                : duration.kind === 'custom'
                  ? CUSTOM_DURATION
                  : duration.name
          }
          ariaLabel={t('inspector.duration')}
          disabled={locked}
          options={[
            ...DURATION_NAMES.map((name) => ({ value: name, label: durationLabel(name) })),
            ...(duration?.kind === 'custom'
              ? [
                  {
                    value: CUSTOM_DURATION,
                    label: t('inspector.customDuration', { ticks: duration.ticks }),
                  },
                ]
              : []),
          ]}
          onChange={(value) => {
            if (value === CUSTOM_DURATION) return;
            resizeNotes(store, noteIds, value as DurationName);
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
          store={store}
          score={score}
          tick={startTick}
          disabled={locked}
          onCommit={(tick) => moveNoteToTick(store, notes[0].id, tick)}
        />
      ) : null}

      <MixedNumberField
        label={t('inspector.velocity')}
        value={velocity}
        min={0}
        max={127}
        disabled={locked}
        // `changeVelocity` rounds and clamps to 0-127 itself.
        onCommit={(v) => dispatchVelocity(store, v)}
      />

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.articulation')}</span>
        <MixedSelect
          value={articulation}
          ariaLabel={t('inspector.articulation')}
          disabled={locked}
          options={ARTICULATION_OPTIONS.map((a) => ({ value: a.value, label: t(a.labelKey) }))}
          onChange={(value) => dispatchArticulation(store, value === NO_MARK ? undefined : value)}
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
          disabled={locked}
          // A marking is written the same in every language — `pp` is `pp` —
          // so only the "no dynamic" entry is translated; the native sheet
          // labels the list the same way.
          options={DYNAMIC_OPTIONS.map((option) => ({
            value: option.value,
            label: option.value === NO_MARK ? t(option.labelKey) : option.value,
          }))}
          onChange={(value) =>
            setDynamic(store, noteIds, value === NO_MARK ? undefined : (value as Dynamic))
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
          aria-label={t('inspector.trackReadOnly')}
          className={TEXT_INPUT_CLASS}
          readOnly
        />
      </label>

      <MixedNumberField
        label={t('inspector.voice')}
        value={commonValue(
          // Counted from 1, matching the toolbar's own Voice 1 / Voice 2
          // buttons. The same note used to read as "Voice 1" on the bar and
          // "0" here.
          notes.map((n) => voiceNumberOf(score, n)),
        )}
        min={1}
        disabled={locked}
        onCommit={(v) => setVoice(store, noteIds, Math.round(v) - 1)}
      />

      <div className="flex gap-4">
        <MixedCheckbox
          label={t('inspector.tieStart')}
          checked={tieStart === true}
          indeterminate={tieStart === MIXED}
          disabled={locked}
          onChange={() => dispatchToggleTie(store, 'tieStart')}
        />
        <MixedCheckbox
          label={t('inspector.tieStop')}
          checked={tieStop === true}
          indeterminate={tieStop === MIXED}
          disabled={locked}
          onChange={() => dispatchToggleTie(store, 'tieStop')}
        />
      </div>

      {/*
        The chord symbol printed above the stave from this note. A lead sheet
        is mostly this field, so it sits with the note's own properties rather
        than behind a mode — and it is a free text box, because a player's
        vocabulary is wider than any list a picker could offer.
      */}
      {noteTextFieldsVisible(notes) ? (
        <ChordSymbolField store={store} note={notes[0]} disabled={locked} />
      ) : null}

      {/* The finger, per note — in a chord each notehead has its own. A draft
          seeded from the first of several notes would overwrite the rest on
          blur, which is why both text fields need exactly one. */}
      {noteTextFieldsVisible(notes) ? (
        <FingeringField store={store} note={notes[0]} disabled={locked} />
      ) : null}

      {/*
        Spans over the selection: an octave bracket and a slide. Both need two
        notes — a bracket over one note has nothing to span and a slide has
        nothing to slide to — so both disable rather than failing silently.
      */}
      <div className="flex flex-col gap-2">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.spans')}</span>
        <div className="flex flex-wrap gap-2">
          {OTTAVAS.map((kind) => (
            <Button
              key={kind}
              type="button"
              variant="ghost"
              size="sm"
              disabled={locked || notes.length < 2}
              onClick={() => toggleOttava(store, kind)}
            >
              {kind}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={locked || notes.length < 2}
            onClick={() => toggleGlissando(store)}
          >
            {t('inspector.glissando')}
          </Button>
        </div>
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
            disabled={locked}
            onClick={() => toGraceNote(store, notes[0].id)}
            className="w-full px-3 py-1.5 text-sm"
          >
            {t('inspector.makeGraceNote')}
          </Button>
          {notes[0].graceNotes?.length ? (
            <Button
              type="button"
              variant="ghost"
              disabled={locked}
              onClick={() => clearGraceNotes(store, [notes[0].id])}
              className="w-full px-3 py-1 text-xs"
            >
              {t('inspector.clearGraceNotes', { count: notes[0].graceNotes.length })}
            </Button>
          ) : null}
        </div>
      ) : null}

      <ReplaceButton
        store={store}
        scope="notes"
        label={t('inspector.replaceNotes')}
        onReplace={onReplace}
      />
    </div>
  );
}

function MeasureTab({ store, onReplace }: TabProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const locked = store(selectEditLocked);

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
  /*
    The number a player reads, not `index + 1`: a pickup is not counted, so on a
    score that opens with one every bar after it is one lower than its position.
    The canvas gutter, "go to bar" and MusicXML export all go through
    `barNumberAt`; a heading that did not was the one place bar 2 was called
    bar 3. A pickup has no number and is named as what it is.
  */
  const firstTrack = score.tracks[0]?.measures ?? [];
  const numbers = measures
    .map((m) => barNumberAt(firstTrack, m.index))
    .filter((n): n is number => n !== null);

  const applyTimeSignature = (timeSignature: TimeSignature): void => {
    setTimeSignature(store, selection.measureIds, timeSignature);
  };
  const applyKeySignature = (keySignature: KeySignature): void => {
    setKeySignature(store, selection.measureIds, keySignature);
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      <p className="text-sm font-semibold text-theme-text-primary">
        {numbers.length === 0
          ? t('inspector.pickup')
          : measures.length > 1 && numbers.length > 1
            ? t('inspector.measureRange', {
                from: Math.min(...numbers),
                to: Math.max(...numbers),
              })
            : t('inspector.measureNumber', { number: numbers[0] })}
      </p>

      <div className="flex gap-2">
        <MixedNumberField
          label={t('inspector.timeSigNumerator')}
          value={timeSig === MIXED ? MIXED : (timeSig?.numerator ?? null)}
          min={1}
          max={MAX_TIME_SIG_NUMERATOR}
          disabled={locked}
          onCommit={(v) =>
            applyTimeSignature({
              numerator: Math.min(MAX_TIME_SIG_NUMERATOR, Math.max(1, Math.round(v))),
              denominator: timeSig !== MIXED ? (timeSig?.denominator ?? 4) : 4,
            })
          }
        />
        {/*
          A picker, not a number: a denominator is one of a handful of note
          values, and there is no nearest one to snap a typed 3 to —
          `setTimeSignature` refuses it, so a free field would look live and
          then do nothing.
        */}
        <label className="flex flex-1 flex-col gap-1">
          <span className={FIELD_LABEL_CLASS}>{t('inspector.timeSigDenominator')}</span>
          <MixedSelect
            value={timeSig === MIXED ? MIXED : timeSig ? String(timeSig.denominator) : null}
            ariaLabel={t('inspector.timeSigDenominator')}
            disabled={locked}
            options={TIME_SIG_DENOMINATOR_OPTIONS.map((d) => ({
              value: String(d),
              label: String(d),
            }))}
            onChange={(value) =>
              applyTimeSignature({
                numerator: timeSig !== MIXED ? (timeSig?.numerator ?? 4) : 4,
                denominator: Number(value),
              })
            }
          />
        </label>
      </div>

      <div className="flex gap-2">
        {/*
          A key, named. "Key (fifths) 2" is the storage format; the reader is
          looking at D major. The options follow the chosen mode, because two
          sharps is D major or B minor depending on it.
        */}
        <MixedSelect
          value={keySig === MIXED ? MIXED : keySig ? String(keySig.fifths) : null}
          ariaLabel={t('inspector.key')}
          disabled={locked}
          options={keySignatureOptions(keySig !== MIXED ? (keySig?.mode ?? 'major') : 'major').map(
            (option) => ({
              value: String(option.fifths),
              label: keyOptionLabel(t, option, keySig),
            }),
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
          ariaLabel={t('inspector.keyMode')}
          disabled={locked}
          options={KEY_MODE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
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

      {/*
        The clef this bar reads in. One bar at a time: a clef change is a
        boundary like a repeat, and applying it across a span would write the
        same change onto every bar in it.
      */}
      {measures.length === 1 ? <MeasureClefField store={store} measure={measures[0]} /> : null}

      {/* The line this bar ends with. One bar at a time: a barline is a
          boundary, not a property of a span. */}
      {measures.length === 1 ? <BarlineField store={store} measure={measures[0]} /> : null}

      {/* Where a player is sent, and where they stop. One bar at a time: each
          of these marks a single place in the score. */}
      {measures.length === 1 ? <NavigationFields store={store} measure={measures[0]} /> : null}

      {/*
        The pickup, on bar 1 only — an anacrusis is the run-up to bar 1, and a
        short bar elsewhere is an irregular bar that keeps its number.
      */}
      {measures.length === 1 && measures[0].index === 0 ? (
        <PickupField store={store} measure={measures[0]} />
      ) : null}

      {/*
        Repeat structure. One bar at a time: a repeat is a boundary, and
        applying "repeat ends here" to a span of bars would mean a `:|` on
        every one of them.
      */}
      {measures.length === 1 ? <RepeatFields store={store} measure={measures[0]} /> : null}

      <ReplaceButton
        store={store}
        scope="measures"
        label={t('inspector.replaceMeasures')}
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
  const isPlaying = store(selectEditLocked);
  const canDelete = store((s) => s.canDeleteTrack());
  const [pendingDelete, setPendingDelete] = useState(false);

  /**
   * What this track holds that its instrument cannot play.
   *
   * Scanned from the score on the score's identity, like the notation's own
   * marks, so the panel and the page agree by construction rather than by two
   * lookups that could drift.
   */
  const outOfRange = useMemo(
    () => outOfRangeNoteIds(score).byTrack.find((entry) => entry.trackId === track?.id) ?? null,
    [score, track?.id],
  );

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
        message: t('inspector.instrumentRangeError', { instrument: result.instrumentName }),
        severity: 'error',
      });
  };

  const picker = instrumentPickerFor(track);

  // `setTrackMix` clamps and snaps onto the mixer's step itself.
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
            // `renameTrack` trims, refuses a blank name and skips an unchanged
            // one; whatever it declines, the field goes back to the name held.
            if (
              !store.getState().renameTrack(track.id, nameDraft, commandLabel('changeTrackProps'))
            )
              setNameDraft(track.name);
          }}
          aria-label={t('inspector.name')}
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
            catalogue would name the wrong thing. `instrumentPickerFor` says
            which list, value and title — shared with the native sheet — and
            `setTrackInstrument` takes the value either one produces.
          */}
          <SheetSelector
            title={t(picker.titleKey)}
            aria-label={
              isPercussionTrack(track)
                ? t('inspector.kitOf', { name: track.name })
                : t('generate.instrument')
            }
            disabled={isPlaying}
            options={[...picker.options]}
            value={picker.value}
            onChange={chooseInstrument}
            size="large"
            className={`${FIELD_HEIGHT_CLASS} w-full justify-between px-2 py-1.5 text-sm`}
          />
        </div>
      </label>

      {/*
        Notes this instrument cannot play, said in words.

        The notation marks them in its own colour, which tells a reader that
        something is wrong with a note; this says what, beside the instrument
        picker — which is the other half of the fix available to them, since
        choosing an instrument that can play the part is as valid an answer as
        moving the notes.
      */}
      {outOfRange ? (
        <p className="text-xs text-theme-text-secondary">
          {t('inspector.outOfRange', {
            count: outOfRange.count,
            low: pitchToString(midiToPitch(outOfRange.compass.min)),
            high: pitchToString(midiToPitch(outOfRange.compass.max)),
          })}
        </p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('importMidi.colClef')}</span>
        <MixedSelect
          value={track.clef}
          ariaLabel={t('inspector.trackClef')}
          disabled={isPlaying}
          options={CLEF_OPTIONS.map((c) => ({ value: c.value, label: t(c.labelKey) }))}
          onChange={(value) =>
            store.getState().setTrackClef(track.id, value as Clef, commandLabel('changeClef'))
          }
        />
      </label>

      <CommitSlider
        label={t('inspector.trackVolume')}
        rowLabel={t('inspector.volume')}
        value={track.volume}
        onCommit={(v) => mix({ volume: v })}
        kind="volume"
      />
      <CommitSlider
        label={t('inspector.trackPan')}
        rowLabel={t('inspector.pan')}
        value={track.pan}
        onCommit={(v) => mix({ pan: v })}
        kind="pan"
      />

      <div className="flex gap-4">
        <MixedCheckbox
          label={t('inspector.mute')}
          checked={track.muted === true}
          onChange={(checked) => mix({ muted: checked })}
        />
        <MixedCheckbox
          label={t('inspector.solo')}
          checked={track.solo === true}
          onChange={(checked) => mix({ solo: checked })}
        />
      </div>

      <ReplaceButton
        store={store}
        scope="track"
        label={t('inspector.replaceTrack')}
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
        aria-label={t('inspector.deleteTrack')}
      >
        {t('inspector.deleteTrack')}
      </Button>

      <ConfirmDialog
        open={pendingDelete}
        title={t('inspector.deleteTrack')}
        message={t('inspector.deleteTrackConfirm', { name: track.name })}
        confirmLabel={t('inspector.deleteTrack')}
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
function ScoreTab({
  store,
  generation,
}: {
  store: EditorStoreApi;
  generation?: GenerationChoicesProps;
}) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const isPlaying = store(selectEditLocked);

  const [title, setTitle] = useState(score?.metadata.title ?? '');
  const [composer, setComposer] = useState(score?.metadata.composer ?? '');

  useEffect(() => {
    setTitle(score?.metadata.title ?? '');
    setComposer(score?.metadata.composer ?? '');
  }, [score?.metadata.title, score?.metadata.composer]);

  if (!score)
    return <p className="p-2 text-sm text-theme-text-primary">{t('inspector.noScore')}</p>;

  // `setScoreMetadata` trims, refuses a blank title and skips a field that has
  // not changed, answering whether it wrote. Whatever it declines, the draft
  // goes back to what the score holds.
  const commit = (patch: { title?: string; composer?: string }): boolean =>
    store.getState().setScoreMetadata(patch, commandLabel('changeMetadata'));

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
            if (!commit({ title })) setTitle(score.metadata.title);
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
            if (!commit({ composer })) setComposer(score.metadata.composer ?? '');
          }}
          className={TEXT_INPUT_CLASS}
        />
      </label>

      <p className="text-xs text-theme-text-secondary">{t('inspector.scoreTitleHint')}</p>

      {generation && <GenerationChoices {...generation} />}
    </div>
  );
}

/**
 * A key picker entry, in the reader's language.
 *
 * `keySignatureOptions` answers the tonic and the count apart because "major",
 * "minor" and "2 sharps" are words a translator owns; its own `label` is the
 * English sentence this panel used to print straight into a Chinese build. The
 * tonic is a note name and reads the same everywhere.
 */
function keyOptionLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  option: KeySignatureOption,
  keySig: KeySignature | typeof MIXED | null,
): string {
  const mode = keySig !== MIXED ? (keySig?.mode ?? 'major') : 'major';
  const accidentals =
    option.accidentalKind === 'none'
      ? t('inspector.keyNoAccidentals')
      : t(option.accidentalKind === 'sharp' ? 'inspector.keySharps' : 'inspector.keyFlats', {
          count: option.accidentalCount,
        });
  return t(mode === 'minor' ? 'inspector.keyOptionMinor' : 'inspector.keyOptionMajor', {
    tonic: option.tonic,
    accidentals,
  });
}

export function InspectorPanel({
  store = useAppStore,
  onReplace,
  generation,
}: InspectorPanelProps) {
  const { t } = useTranslation();
  const selection = store((s) => s.selection);
  const [tab, setTab] = useState<InspectorTab>(() => defaultInspectorTab(selection));

  // Re-derive the default tab whenever the selection's *kind* changes (a
  // fresh note/measure/track click), without fighting the user's own tab
  // clicks in between (only runs off `selection`, not `tab`).
  useEffect(() => {
    setTab(defaultInspectorTab(selection));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.eventIds, selection.measureIds, selection.trackIds]);

  return (
    <div className="flex h-full flex-col overflow-auto" aria-label={t('editor.inspectorPanel')}>
      <Tabs value={tab} onValueChange={(value) => setTab(value as InspectorTab)}>
        {/*
          A segmented control rather than a tab strip.

          Four sections at the top of a panel is what a segmented control is
          for, and it is what both mobile apps show — iOS a real
          `UISegmentedControl`, macOS and Android a drawn one — so the web
          reading as a web page's tab strip was the odd one out.

          `ToggleGroup` is `@sudobility/components`' own ("similar to iOS
          segmented control"), so this is the library's control rather than a
          fourth drawing of the same thing.

          Kept inside `Tabs`: the panels are still `TabsContent`, which is what
          gives each one its `tabpanel` role and its `aria-labelledby`. Only the
          strip changes.
        */}
        <TabsList aria-label={t('editor.inspectorTabs')} asChild>
          <ToggleGroup
            role="tablist"
            size="sm"
            // Score, Track, Note, Bar — music_editing's order, so a reader moving
            // between the apps finds each tab in the same place.
            options={INSPECTOR_TABS.map((value) => ({
              value,
              label: t(INSPECTOR_TAB_LABEL_KEY[value]),
            }))}
            value={tab}
            onChange={(value) => setTab(value as InspectorTab)}
          />
        </TabsList>
        <TabsContent value="score">
          <ScoreTab store={store} generation={generation} />
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
