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
import { useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
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
  gmWrittenTransposition,
  soundingPitch,
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

export type InspectorPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
};

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
const ARTICULATIONS: Array<{ value: Articulation | 'none'; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'staccato', label: 'Staccato' },
  { value: 'accent', label: 'Accent' },
  { value: 'tenuto', label: 'Tenuto' },
  { value: 'marcato', label: 'Marcato' },
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
            Mixed
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
        placeholder={value === MIXED ? 'Mixed' : undefined}
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

/** The measure holding `note`, found by its track and tick, for the key signature. */
function measureOfNote(score: Score, note: NoteEvent): Measure | null {
  const track = findTrack(score, note.trackId);
  return (
    track?.measures.find(
      (m) => note.startTick >= m.startTick && note.startTick < m.startTick + m.durationTicks,
    ) ?? null
  );
}

function NoteTab({ store }: { store: EditorStoreApi }) {
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const pitchDisplay = store((s) => s.pitchDisplay);

  if (!score) return <p className="p-2 text-sm text-theme-text-primary">No score loaded.</p>;
  const noteIds = selectedNoteIds(score, selection);
  const notes = noteIds
    .map((id) => findEvent(score, id))
    .filter((e): e is NoteEvent => e !== null && isNoteEvent(e));

  if (notes.length === 0) {
    return (
      <p className="p-2 text-sm text-theme-text-secondary">
        Select a note to inspect its properties.
      </p>
    );
  }

  /**
   * The pitch as the reader sees it: sounding in concert mode, and the
   * player's own written pitch otherwise. Zero shift for a non-transposing
   * instrument, so the common path returns the stored object untouched.
   */
  const shown = (note: NoteEvent): Pitch => {
    const semitones =
      pitchDisplay === 'written'
        ? gmWrittenTransposition(findTrack(score, note.trackId)?.midiProgram ?? 0)
        : 0;
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
      const program = findTrack(score, note.trackId)?.midiProgram ?? 0;
      const key = measureOfNote(score, note)?.keySignature ?? { fifths: 0, mode: 'major' };
      const next = pitchDisplay === 'written' ? soundingPitch(edited, program, key) : edited;
      store.getState().dispatchCommand(changePitchCommand([note.id], next));
    }
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      <p className="text-sm font-semibold text-theme-text-primary">
        {notes.length > 1 ? `${notes.length} notes selected` : 'Note'}
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
          label="Octave"
          value={octave}
          onCommit={(v) => applyPitchPatch({ octave: v })}
        />
      </div>

      <MixedNumberField
        label="Duration (ticks)"
        value={durationTicks}
        min={1}
        onCommit={(v) =>
          store.getState().dispatchCommand(resizeNotesCommand(noteIds, Math.max(1, Math.round(v))))
        }
      />

      <MixedNumberField
        label="Start position (ticks)"
        value={notes.length === 1 ? startTick : null}
        min={0}
        onCommit={(v) => {
          if (notes.length !== 1) return;
          const note = notes[0];
          store
            .getState()
            .dispatchCommand(
              moveNotesCommand([note.id], { deltaTicks: v - note.startTick, deltaSemitones: 0 }),
            );
        }}
      />

      <MixedNumberField
        label="Velocity"
        value={velocity}
        min={0}
        max={127}
        onCommit={(v) => dispatchVelocity(store, Math.max(0, Math.min(127, Math.round(v))))}
      />

      <MixedSelect
        value={articulation}
        ariaLabel="Articulation"
        options={ARTICULATIONS.map((a) => ({ value: a.value, label: a.label }))}
        onChange={(value) => dispatchArticulation(store, value === 'none' ? undefined : value)}
      />

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>Track</span>
        <Input
          value={trackName === MIXED ? '' : (trackName ?? '')}
          placeholder={trackName === MIXED ? 'Mixed' : undefined}
          disabled
          aria-label="Track (read-only)"
          className={TEXT_INPUT_CLASS}
          readOnly
        />
      </label>

      <MixedNumberField
        label="Voice"
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
          store.getState().dispatchCommand(changeVoiceCommand(noteIds, Math.max(0, Math.round(v))))
        }
      />

      <div className="flex gap-4">
        <MixedCheckbox
          label="Tie start"
          checked={tieStart === true}
          indeterminate={tieStart === MIXED}
          onChange={() => dispatchToggleTie(store, 'tieStart')}
        />
        <MixedCheckbox
          label="Tie stop"
          checked={tieStop === true}
          indeterminate={tieStop === MIXED}
          onChange={() => dispatchToggleTie(store, 'tieStop')}
        />
      </div>
    </div>
  );
}

function MeasureTab({ store }: { store: EditorStoreApi }) {
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);

  if (!score) return <p className="p-2 text-sm text-theme-text-primary">No score loaded.</p>;
  const measures = selection.measureIds
    .map((id) => findMeasure(score, id))
    .filter((m) => m !== null);

  if (measures.length === 0) {
    return (
      <p className="p-2 text-sm text-theme-text-secondary">
        Select a measure to inspect its properties.
      </p>
    );
  }

  const timeSig = commonValue(measures.map((m) => m.timeSignature));
  const keySig = commonValue(measures.map((m) => m.keySignature));
  const indices = measures.map((m) => m.index + 1);

  const applyTimeSignature = (timeSignature: TimeSignature): void => {
    for (const id of selection.measureIds)
      store.getState().dispatchCommand(changeTimeSignatureCommand(id, timeSignature));
  };
  const applyKeySignature = (keySignature: KeySignature): void => {
    for (const id of selection.measureIds)
      store.getState().dispatchCommand(changeKeySignatureCommand(id, keySignature));
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      <p className="text-sm font-semibold text-theme-text-primary">
        {measures.length > 1
          ? `Measures ${Math.min(...indices)}–${Math.max(...indices)}`
          : `Measure ${indices[0]}`}
      </p>

      <div className="flex gap-2">
        <MixedNumberField
          label="Time sig. numerator"
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
          label="Time sig. denominator"
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
          label="Key (fifths)"
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

      <p className="text-xs text-theme-text-secondary">
        This selection also drives the Regenerate panel — use it to generate alternatives for these
        measures.
      </p>
    </div>
  );
}

function TrackTab({ store }: { store: EditorStoreApi }) {
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);

  // Computed unconditionally (rather than after the "no score"/"no
  // selection" early returns below) so the volume/pan drag-draft hooks
  // just below can be called unconditionally too, per the rules of hooks.
  const tracks = score
    ? selection.trackIds.map((id) => findTrack(score, id)).filter((t) => t !== null)
    : [];
  const volume = commonValue(tracks.map((t) => t.volume));
  const pan = commonValue(tracks.map((t) => t.pan));

  if (!score) return <p className="p-2 text-sm text-theme-text-primary">No score loaded.</p>;

  if (tracks.length === 0) {
    return (
      <p className="p-2 text-sm text-theme-text-secondary">
        Select a track to inspect its properties.
      </p>
    );
  }

  const name = commonValue(tracks.map((t) => t.name));
  const instrumentName = commonValue(tracks.map((t) => t.instrumentName));
  const midiProgram = commonValue(tracks.map((t) => t.midiProgram));
  const midiChannel = commonValue(tracks.map((t) => t.midiChannel));
  const clef = commonValue(tracks.map((t) => t.clef));
  const muted = commonValue(tracks.map((t) => t.muted));
  const solo = commonValue(tracks.map((t) => t.solo));

  const patchAll = (patch: Record<string, unknown>): void => {
    for (const id of selection.trackIds)
      store.getState().dispatchCommand(changeTrackPropsCommand(id, patch));
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      <p className="text-sm font-semibold text-theme-text-primary">
        {tracks.length > 1 ? `${tracks.length} tracks selected` : 'Track'}
      </p>

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>Name</span>
        <Input
          value={name === MIXED ? '' : (name ?? '')}
          placeholder={name === MIXED ? 'Mixed' : undefined}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patchAll({ name: e.target.value })}
          aria-label="Track name"
          className={TEXT_INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>Instrument</span>
        <Input
          value={instrumentName === MIXED ? '' : (instrumentName ?? '')}
          placeholder={instrumentName === MIXED ? 'Mixed' : undefined}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            patchAll({ instrumentName: e.target.value })
          }
          aria-label="Instrument"
          className={TEXT_INPUT_CLASS}
        />
      </label>
      <div className="flex gap-2">
        <MixedNumberField
          label="MIDI program"
          value={midiProgram}
          min={0}
          max={127}
          onCommit={(v) => patchAll({ midiProgram: Math.max(0, Math.min(127, Math.round(v))) })}
        />
        <MixedNumberField
          label="MIDI channel"
          value={midiChannel}
          min={0}
          max={15}
          onCommit={(v) => patchAll({ midiChannel: Math.max(0, Math.min(15, Math.round(v))) })}
        />
      </div>

      <MixedSelect
        value={clef}
        ariaLabel="Track clef"
        options={CLEFS.map((c) => ({ value: c, label: c }))}
        onChange={(value) => {
          for (const id of selection.trackIds)
            store.getState().dispatchCommand(changeClefCommand(id, value as Clef));
        }}
      />

      <div className="flex items-center gap-2">
        <span className="min-w-[40px] text-xs text-theme-text-secondary">Volume</span>
        <CommitSlider
          label="Track volume"
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
          label="Track pan"
          value={pan === MIXED || pan === null ? 0 : pan}
          onCommit={(v) => patchAll({ pan: v })}
          min={-1}
          max={1}
          step={0.01}
        />
      </div>

      <div className="flex gap-4">
        <MixedCheckbox
          label="Muted"
          checked={muted === true}
          indeterminate={muted === MIXED}
          onChange={(checked) => patchAll({ muted: checked })}
        />
        <MixedCheckbox
          label="Solo"
          checked={solo === true}
          indeterminate={solo === MIXED}
          onChange={(checked) => patchAll({ solo: checked })}
        />
      </div>
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

const TABS: Array<{ value: InspectorTab; label: string }> = [
  { value: 'note', label: 'Note' },
  { value: 'measure', label: 'Measure' },
  { value: 'track', label: 'Track' },
];

export function InspectorPanel({ store = useAppStore }: InspectorPanelProps) {
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
    <div className="flex h-full flex-col overflow-auto" aria-label="Inspector panel">
      <Tabs value={tab} onValueChange={(value) => setTab(value as InspectorTab)}>
        <TabsList aria-label="Inspector tabs">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="note">
          <NoteTab store={store} />
        </TabsContent>
        <TabsContent value="measure">
          <MeasureTab store={store} />
        </TabsContent>
        <TabsContent value="track">
          <TrackTab store={store} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
