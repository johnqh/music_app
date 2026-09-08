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
import { commandLabel } from '@/features/score-editor/command-labels';
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
  ARTICULATION_OPTIONS,
  CLEFS,
  CUSTOM_DURATION,
  FIELD_HEIGHT_CLASS,
  FIELD_LABEL_CLASS,
  MIXED,
  NO_DYNAMIC,
  PITCH_STEPS,
  TEXT_INPUT_CLASS,
  commonValue,
} from '@/components/inspector/shared';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { useEffect, useState } from 'react';
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
  NoteEvent,
  Pitch,
  PitchStep,
  DurationName,
  TimeSignature,
} from '@sudobility/music_types';
import { DYNAMICS, isNoteEvent } from '@sudobility/music_types';
import {
  findEvent,
  findMeasure,
  findTrack,
  replacementRegion,
  selectActiveTrackId,
  isPercussionTrack,
  durationLabel,
  durationNameForTicks,
  keySignatureOptions,
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

type InspectorTab = 'score' | 'note' | 'measure' | 'track';

type TabProps = {
  store: EditorStoreApi;
  onReplace?: (scope: ReplaceScope, submission: ReplaceSubmission) => void;
};

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

  const shown = (note: NoteEvent): Pitch => displayedPitchForNote(score, note, pitchDisplay);

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
          ariaLabel="Pitch step"
          options={PITCH_STEPS.map((s) => ({ value: s, label: s }))}
          onChange={(value) => applyPitchPatch({ step: value })}
        />
        <MixedSelect
          value={accidentalStr}
          ariaLabel="Accidental"
          options={ACCIDENTAL_PICKER.map((a) => ({ value: String(a.value), label: a.label }))}
          onChange={(value) => dispatchAccidental(store, Number(value) as Accidental)}
        />
        <MixedNumberField
          label={t('inspector.octave')}
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
        <span className={FIELD_LABEL_CLASS}>{t('inspector.duration')}</span>
        <MixedSelect
          value={
            durationTicks === MIXED
              ? MIXED
              : durationTicks === null
                ? null
                : (durationNameForTicks(durationTicks, score.ppq) ?? CUSTOM_DURATION)
          }
          ariaLabel={t('inspector.duration')}
          options={[
            ...DURATION_NAMES.map((name) => ({ value: name, label: durationLabel(name) })),
            ...(durationTicks !== MIXED &&
            durationTicks !== null &&
            durationNameForTicks(durationTicks, score.ppq) === null
              ? [
                  {
                    value: CUSTOM_DURATION,
                    label: t('inspector.customDuration', { ticks: durationTicks }),
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
          score={score}
          tick={startTick}
          onCommit={(tick) => moveNoteToTick(store, notes[0].id, tick)}
        />
      ) : null}

      <MixedNumberField
        label={t('inspector.velocity')}
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
          options={ARTICULATION_OPTIONS.map((a) => ({ value: a.value, label: t(a.labelKey) }))}
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
            setDynamic(store, noteIds, value === NO_DYNAMIC ? undefined : (value as Dynamic))
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
        onCommit={(v) => setVoice(store, noteIds, Math.round(v) - 1)}
      />

      <div className="flex gap-4">
        <MixedCheckbox
          label={t('inspector.tieStart')}
          checked={tieStart === true}
          indeterminate={tieStart === MIXED}
          onChange={() => dispatchToggleTie(store, 'tieStart')}
        />
        <MixedCheckbox
          label={t('inspector.tieStop')}
          checked={tieStop === true}
          indeterminate={tieStop === MIXED}
          onChange={() => dispatchToggleTie(store, 'tieStop')}
        />
      </div>

      {/*
        The chord symbol printed above the stave from this note. A lead sheet
        is mostly this field, so it sits with the note's own properties rather
        than behind a mode — and it is a free text box, because a player's
        vocabulary is wider than any list a picker could offer.
      */}
      {notes.length === 1 ? (
        <ChordSymbolField store={store} note={notes[0]} disabled={isPlayingNow} />
      ) : null}

      {/* The finger, per note — in a chord each notehead has its own. */}
      {notes.length === 1 ? (
        <FingeringField store={store} note={notes[0]} disabled={isPlayingNow} />
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
              disabled={isPlayingNow || notes.length < 2}
              onClick={() => toggleOttava(store, kind)}
            >
              {kind}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPlayingNow || notes.length < 2}
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
            disabled={isPlayingNow}
            onClick={() => toGraceNote(store, notes[0].id)}
            className="w-full px-3 py-1.5 text-sm"
          >
            {t('inspector.makeGraceNote')}
          </Button>
          {notes[0].graceNotes?.length ? (
            <Button
              type="button"
              variant="ghost"
              disabled={isPlayingNow}
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
    setTimeSignature(store, selection.measureIds, timeSignature);
  };
  const applyKeySignature = (keySignature: KeySignature): void => {
    setKeySignature(store, selection.measureIds, keySignature);
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
          label={t('inspector.timeSigNumerator')}
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
          label={t('inspector.timeSigDenominator')}
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
          ariaLabel={t('inspector.key')}
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
        message: t('inspector.instrumentRangeError', { instrument: result.instrumentName }),
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
            catalogue would name the wrong thing. Which list is showing is the
            only difference here — `setTrackInstrument` takes the value either
            one produces and resolves it.
          */}
          {isPercussionTrack(track) ? (
            <SheetSelector
              title={t('inspector.drumKit')}
              aria-label={t('inspector.kitOf', { name: track.name })}
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
            options={TABS.map((tab_) => ({
              value: tab_.value,
              label: t(tab_.labelKey),
            }))}
            value={tab}
            onChange={(value) => setTab(value as InspectorTab)}
          />
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
