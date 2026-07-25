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
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import type { SelectChangeEvent } from '@mui/material/Select';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Accidental, Articulation, Clef, KeySignature, NoteEvent, PitchStep, TimeSignature } from '@/domain/score/types';
import { isNoteEvent } from '@/domain/score/types';
import { findEvent, findMeasure, findTrack } from '@/domain/score/queries';
import {
  changeAccidental as dispatchAccidental,
  changeArticulation as dispatchArticulation,
  changeVelocity as dispatchVelocity,
  selectedNoteIds,
  toggleTie as dispatchToggleTie,
} from '@/features/score-editor/editing';
import { changePitchCommand, changeVoiceCommand, moveNotesCommand, resizeNotesCommand } from '@/domain/commands/note-commands';
import {
  changeClefCommand,
  changeKeySignatureCommand,
  changeTimeSignatureCommand,
  changeTrackPropsCommand,
} from '@/domain/commands/structure-commands';
import { useAppStore } from '@/store/useAppStore';
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

/** A `<Select>` that renders a synthetic disabled "Mixed" option when `value` is `MIXED`, otherwise the given options. Selecting a real option always calls `onChange` with that option's own value (never `MIXED`). */
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
  const selectValue = value === MIXED ? MIXED_VALUE : (value ?? '');
  return (
    <Select
      size="small"
      value={selectValue}
      disabled={disabled || value === null}
      onChange={(e: SelectChangeEvent) => {
        if (e.target.value === MIXED_VALUE) return;
        onChange(e.target.value as T);
      }}
      inputProps={{ 'aria-label': ariaLabel }}
    >
      {value === MIXED && (
        <MenuItem value={MIXED_VALUE} disabled>
          Mixed
        </MenuItem>
      )}
      {options.map((opt) => (
        <MenuItem key={opt.value} value={opt.value}>
          {opt.label}
        </MenuItem>
      ))}
    </Select>
  );
}

/** A numeric `<TextField>` showing an empty value + "Mixed" placeholder when `value` is `MIXED`. Commits on blur/Enter, not on every keystroke, so a partial/invalid draft never dispatches a command. */
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
    <TextField
      size="small"
      type="number"
      label={label}
      value={draft}
      placeholder={value === MIXED ? 'Mixed' : undefined}
      disabled={disabled || value === null}
      onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      slotProps={{ htmlInput: { 'aria-label': label, min, max, step } }}
    />
  );
}

function NoteTab({ store }: { store: EditorStoreApi }) {
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);

  if (!score) return <Typography variant="body2">No score loaded.</Typography>;
  const noteIds = selectedNoteIds(score, selection);
  const notes = noteIds.map((id) => findEvent(score, id)).filter((e): e is NoteEvent => e !== null && isNoteEvent(e));

  if (notes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Select a note to inspect its properties.
      </Typography>
    );
  }

  const step = commonValue(notes.map((n) => n.pitch.step));
  const accidentalStr = commonValue(notes.map((n) => String(n.pitch.accidental)));
  const octave = commonValue(notes.map((n) => n.pitch.octave));
  const durationTicks = commonValue(notes.map((n) => n.durationTicks));
  const startTick = commonValue(notes.map((n) => n.startTick));
  const velocity = commonValue(notes.map((n) => n.velocity));
  const articulation = commonValue(notes.map((n) => n.articulation ?? 'none'));
  const trackName = commonValue(notes.map((n) => findTrack(score, n.trackId)?.name ?? '?'));
  const tieStart = commonValue(notes.map((n) => n.tieStart ?? false));
  const tieStop = commonValue(notes.map((n) => n.tieStop ?? false));

  const applyPitchPatch = (patch: Partial<{ step: PitchStep; accidental: Accidental; octave: number }>): void => {
    for (const note of notes) {
      store.getState().dispatchCommand(changePitchCommand([note.id], { ...note.pitch, ...patch }));
    }
  };

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="subtitle2">{notes.length > 1 ? `${notes.length} notes selected` : 'Note'}</Typography>

      <Stack direction="row" spacing={1}>
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
        <MixedNumberField label="Octave" value={octave} onCommit={(v) => applyPitchPatch({ octave: v })} />
      </Stack>

      <MixedNumberField
        label="Duration (ticks)"
        value={durationTicks}
        min={1}
        onCommit={(v) => store.getState().dispatchCommand(resizeNotesCommand(noteIds, Math.max(1, Math.round(v))))}
      />

      <MixedNumberField
        label="Start position (ticks)"
        value={notes.length === 1 ? startTick : null}
        min={0}
        onCommit={(v) => {
          if (notes.length !== 1) return;
          const note = notes[0];
          store.getState().dispatchCommand(moveNotesCommand([note.id], { deltaTicks: v - note.startTick, deltaSemitones: 0 }));
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

      <TextField size="small" label="Track" value={trackName === MIXED ? '' : (trackName ?? '')} placeholder={trackName === MIXED ? 'Mixed' : undefined} disabled slotProps={{ htmlInput: { 'aria-label': 'Track (read-only)' } }} />

      <MixedNumberField
        label="Voice"
        value={commonValue(
          notes.map((n) => {
            const measure = score.tracks.flatMap((t) => t.measures).find((m) => m.voices.some((v) => v.id === n.voiceId));
            return measure ? measure.voices.findIndex((v) => v.id === n.voiceId) : 0;
          }),
        )}
        min={0}
        onCommit={(v) => store.getState().dispatchCommand(changeVoiceCommand(noteIds, Math.max(0, Math.round(v))))}
      />

      <Stack direction="row" spacing={2}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={tieStart === true}
              indeterminate={tieStart === MIXED}
              onChange={() => dispatchToggleTie(store, 'tieStart')}
              slotProps={{ input: { 'aria-label': 'Tie start' } }}
            />
          }
          label="Tie start"
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={tieStop === true}
              indeterminate={tieStop === MIXED}
              onChange={() => dispatchToggleTie(store, 'tieStop')}
              slotProps={{ input: { 'aria-label': 'Tie stop' } }}
            />
          }
          label="Tie stop"
        />
      </Stack>
    </Stack>
  );
}

function MeasureTab({ store }: { store: EditorStoreApi }) {
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);

  if (!score) return <Typography variant="body2">No score loaded.</Typography>;
  const measures = selection.measureIds.map((id) => findMeasure(score, id)).filter((m) => m !== null);

  if (measures.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Select a measure to inspect its properties.
      </Typography>
    );
  }

  const timeSig = commonValue(measures.map((m) => m.timeSignature));
  const keySig = commonValue(measures.map((m) => m.keySignature));
  const indices = measures.map((m) => m.index + 1);

  const applyTimeSignature = (timeSignature: TimeSignature): void => {
    for (const id of selection.measureIds) store.getState().dispatchCommand(changeTimeSignatureCommand(id, timeSignature));
  };
  const applyKeySignature = (keySignature: KeySignature): void => {
    for (const id of selection.measureIds) store.getState().dispatchCommand(changeKeySignatureCommand(id, keySignature));
  };

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="subtitle2">
        {measures.length > 1 ? `Measures ${Math.min(...indices)}–${Math.max(...indices)}` : `Measure ${indices[0]}`}
      </Typography>

      <Stack direction="row" spacing={1}>
        <MixedNumberField
          label="Time sig. numerator"
          value={timeSig === MIXED ? MIXED : timeSig?.numerator ?? null}
          min={1}
          onCommit={(v) => applyTimeSignature({ numerator: Math.max(1, Math.round(v)), denominator: timeSig !== MIXED ? (timeSig?.denominator ?? 4) : 4 })}
        />
        <MixedNumberField
          label="Time sig. denominator"
          value={timeSig === MIXED ? MIXED : timeSig?.denominator ?? null}
          min={1}
          onCommit={(v) => applyTimeSignature({ numerator: timeSig !== MIXED ? (timeSig?.numerator ?? 4) : 4, denominator: Math.max(1, Math.round(v)) })}
        />
      </Stack>

      <Stack direction="row" spacing={1}>
        <MixedNumberField
          label="Key (fifths)"
          value={keySig === MIXED ? MIXED : keySig?.fifths ?? null}
          min={-7}
          max={7}
          onCommit={(v) => applyKeySignature({ fifths: Math.round(v), mode: keySig !== MIXED ? (keySig?.mode ?? 'major') : 'major' })}
        />
        <MixedSelect
          value={keySig === MIXED ? MIXED : keySig?.mode ?? null}
          ariaLabel="Key mode"
          options={[
            { value: 'major', label: 'major' },
            { value: 'minor', label: 'minor' },
          ]}
          onChange={(value) => applyKeySignature({ fifths: keySig !== MIXED ? (keySig?.fifths ?? 0) : 0, mode: value as KeySignature['mode'] })}
        />
      </Stack>

      <Typography variant="caption" color="text.secondary">
        This selection also drives the Regenerate panel — use it to generate alternatives for these measures.
      </Typography>
    </Stack>
  );
}

function TrackTab({ store }: { store: EditorStoreApi }) {
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);

  // Computed unconditionally (rather than after the "no score"/"no
  // selection" early returns below) so the volume/pan drag-draft hooks
  // just below can be called unconditionally too, per the rules of hooks.
  const tracks = score ? selection.trackIds.map((id) => findTrack(score, id)).filter((t) => t !== null) : [];
  const volume = commonValue(tracks.map((t) => t.volume));
  const pan = commonValue(tracks.map((t) => t.pan));

  // Local drag drafts (see TrackPanel.tsx's identical pattern/doc comment):
  // MUI's Slider fires `onChange` on every pointer-move tick during a drag;
  // dispatching a ScoreCommand per tick would flood undo history. The
  // command is dispatched once, from `onChangeCommitted`, while these
  // drafts keep the thumb tracking the drag live -- synced back to the
  // selection's real (possibly "mixed") value on any external change.
  const [volumeDraft, setVolumeDraft] = useState(volume === MIXED || volume === null ? 1 : volume);
  const [panDraft, setPanDraft] = useState(pan === MIXED || pan === null ? 0 : pan);

  useEffect(() => {
    setVolumeDraft(volume === MIXED || volume === null ? 1 : volume);
  }, [volume]);
  useEffect(() => {
    setPanDraft(pan === MIXED || pan === null ? 0 : pan);
  }, [pan]);

  if (!score) return <Typography variant="body2">No score loaded.</Typography>;

  if (tracks.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Select a track to inspect its properties.
      </Typography>
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
    for (const id of selection.trackIds) store.getState().dispatchCommand(changeTrackPropsCommand(id, patch));
  };

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="subtitle2">{tracks.length > 1 ? `${tracks.length} tracks selected` : 'Track'}</Typography>

      <TextField
        size="small"
        label="Name"
        value={name === MIXED ? '' : name ?? ''}
        placeholder={name === MIXED ? 'Mixed' : undefined}
        onChange={(e) => patchAll({ name: e.target.value })}
        slotProps={{ htmlInput: { 'aria-label': 'Track name' } }}
      />
      <TextField
        size="small"
        label="Instrument"
        value={instrumentName === MIXED ? '' : instrumentName ?? ''}
        placeholder={instrumentName === MIXED ? 'Mixed' : undefined}
        onChange={(e) => patchAll({ instrumentName: e.target.value })}
        slotProps={{ htmlInput: { 'aria-label': 'Instrument' } }}
      />
      <Stack direction="row" spacing={1}>
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
      </Stack>

      <MixedSelect
        value={clef}
        ariaLabel="Track clef"
        options={CLEFS.map((c) => ({ value: c, label: c }))}
        onChange={(value) => {
          for (const id of selection.trackIds) store.getState().dispatchCommand(changeClefCommand(id, value as Clef));
        }}
      />

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" sx={{ minWidth: 40 }}>
          Volume
        </Typography>
        <Slider
          size="small"
          min={0}
          max={1}
          step={0.01}
          value={volumeDraft}
          aria-label="Track volume"
          onChange={(_e, v) => setVolumeDraft(Array.isArray(v) ? v[0] : v)}
          onChangeCommitted={(_e, v) => patchAll({ volume: Array.isArray(v) ? v[0] : v })}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" sx={{ minWidth: 40 }}>
          Pan
        </Typography>
        <Slider
          size="small"
          min={-1}
          max={1}
          step={0.01}
          value={panDraft}
          aria-label="Track pan"
          onChange={(_e, v) => setPanDraft(Array.isArray(v) ? v[0] : v)}
          onChangeCommitted={(_e, v) => patchAll({ pan: Array.isArray(v) ? v[0] : v })}
        />
      </Stack>

      <Stack direction="row" spacing={2}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={muted === true}
              indeterminate={muted === MIXED}
              onChange={(e) => patchAll({ muted: e.target.checked })}
              slotProps={{ input: { 'aria-label': 'Muted' } }}
            />
          }
          label="Muted"
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={solo === true}
              indeterminate={solo === MIXED}
              onChange={(e) => patchAll({ solo: e.target.checked })}
              slotProps={{ input: { 'aria-label': 'Solo' } }}
            />
          }
          label="Solo"
        />
      </Stack>
    </Stack>
  );
}

/** Which tab a fresh selection should default to: notes take priority, then measures, then tracks. */
function defaultTabFor(selection: { eventIds: string[]; measureIds: string[]; trackIds: string[] }): InspectorTab {
  if (selection.eventIds.length > 0) return 'note';
  if (selection.measureIds.length > 0) return 'measure';
  if (selection.trackIds.length > 0) return 'track';
  return 'note';
}

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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }} aria-label="Inspector panel">
      <Tabs value={tab} onChange={(_e, value: InspectorTab) => setTab(value)} aria-label="Inspector tabs">
        <Tab value="note" label="Note" />
        <Tab value="measure" label="Measure" />
        <Tab value="track" label="Track" />
      </Tabs>
      {tab === 'note' && <NoteTab store={store} />}
      {tab === 'measure' && <MeasureTab store={store} />}
      {tab === 'track' && <TrackTab store={store} />}
    </Box>
  );
}
