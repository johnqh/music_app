/**
 * Whole-score generation panel (spec §11, §21, §32): prompt + preset-prompt
 * menu, style/mood/complexity, an instrumentation checklist, measures/
 * tempo/key/time-signature, and a Generate button with
 * progress + cancel. Shown by the app shell (Task 16) when
 * `generation-slice.mode === 'generate'` (an empty selection); its sibling,
 * `RegenerationPanel`, takes over once a region is selected.
 *
 * Two fields spec §21's prose lists alongside these ("candidate count",
 * "seed") no longer apply: whole-score generation adopts exactly one
 * committed score (`GenerateScoreRequest` has no candidateCount; the
 * RegenerationPanel is where a real candidateCount lives), and the seed
 * concept died with the deterministic mock provider — real AI generation
 * (music_api/OpenAI) is not seedable. Both are documented as known
 * limitations in docs/architecture.md.
 */
import { useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import LinearProgress from '@mui/material/LinearProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import type { SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Clef, KeySignature, TimeSignature } from '@sudobility/music_types';
import type { GenerateScoreRequest, GenerateScoreRequestTrack } from '@sudobility/music_types';
import { useAppStore } from '@sudobility/music_lib';
import type { GenerationStoreApi } from '@/features/generation/preview';

export type GenerationPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: GenerationStoreApi;
};

/** Spec §32, verbatim. */
const PRESET_PROMPTS: string[] = [
  'Create a gentle eight-measure piano melody in C major',
  'Create a cinematic sixteen-measure theme in D minor',
  'Create an upbeat pop arrangement with piano, bass, drums, and strings',
  'Create a simple beginner melody using quarter and half notes',
  'Create a jazz-inspired progression with a walking bass',
  'Create an energetic video-game battle theme',
  'Create a calm ambient piano piece',
  'Create a playful waltz in 3/4 time',
];

/** The keyword values `services/generation/prompt-parse.ts`'s `STYLES`/`MOODS` actually branch on — an explicit `style`/`mood` request field only changes generation behavior when it matches one of these. */
const STYLE_OPTIONS = ['waltz', 'jazz', 'pop', 'cinematic', 'ambient', 'battle'];
const MOOD_OPTIONS = ['gentle', 'dark', 'upbeat', 'dramatic', 'calm', 'energetic'];
const COMPLEXITY_OPTIONS: NonNullable<GenerateScoreRequest['complexity']>[] = ['simple', 'moderate', 'complex'];

type InstrumentKey = 'piano' | 'electric-piano' | 'strings' | 'bass' | 'synth-lead' | 'drums';

/**
 * Instrumentation checklist (brief: "Piano/Electric Piano/Strings/Bass/
 * Synth Lead/Drums with sensible programs/clefs"). GM program numbers
 * chosen to land in `adapters/tone/instruments.ts`'s matching category
 * band, and order matters: `mock-provider.ts`'s `classifyTrackRole` gives
 * melody to the *first* treble-clef track, so Piano leading the list means
 * "just Piano" (the default selection) gets the melody, matching
 * `DEFAULT_TRACK`'s own single-piano fallback.
 */
const INSTRUMENT_OPTIONS: Array<{ key: InstrumentKey; label: string; instrumentName: string; midiProgram: number; clef: Clef }> = [
  { key: 'piano', label: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' },
  { key: 'electric-piano', label: 'Electric Piano', instrumentName: 'Electric Piano', midiProgram: 4, clef: 'treble' },
  { key: 'strings', label: 'Strings', instrumentName: 'Strings', midiProgram: 48, clef: 'treble' },
  { key: 'bass', label: 'Bass', instrumentName: 'Bass', midiProgram: 32, clef: 'bass' },
  { key: 'synth-lead', label: 'Synth Lead', instrumentName: 'Synth Lead', midiProgram: 80, clef: 'treble' },
  { key: 'drums', label: 'Drums', instrumentName: 'Drums', midiProgram: 0, clef: 'percussion' },
];

/** fifths -7..7, labeled by their major-key tonic (spec §21 "key"; the separate Mode select supplies major/minor). */
const KEY_FIFTHS_OPTIONS: Array<{ fifths: number; label: string }> = [
  { fifths: -7, label: 'Cb' },
  { fifths: -6, label: 'Gb' },
  { fifths: -5, label: 'Db' },
  { fifths: -4, label: 'Ab' },
  { fifths: -3, label: 'Eb' },
  { fifths: -2, label: 'Bb' },
  { fifths: -1, label: 'F' },
  { fifths: 0, label: 'C' },
  { fifths: 1, label: 'G' },
  { fifths: 2, label: 'D' },
  { fifths: 3, label: 'A' },
  { fifths: 4, label: 'E' },
  { fifths: 5, label: 'B' },
  { fifths: 6, label: 'F#' },
  { fifths: 7, label: 'C#' },
];

const TIME_SIGNATURE_OPTIONS: Record<string, TimeSignature> = {
  '4/4': { numerator: 4, denominator: 4 },
  '3/4': { numerator: 3, denominator: 4 },
  '2/4': { numerator: 2, denominator: 4 },
  '6/8': { numerator: 6, denominator: 8 },
  '5/4': { numerator: 5, denominator: 4 },
  '7/8': { numerator: 7, denominator: 8 },
};

const DEFAULT_MEASURES = 8;

function toRequestTrack(option: (typeof INSTRUMENT_OPTIONS)[number]): GenerateScoreRequestTrack {
  return { name: option.label, instrumentName: option.instrumentName, midiProgram: option.midiProgram, clef: option.clef };
}

export function GenerationPanel({ store = useAppStore }: GenerationPanelProps) {
  const pending = store((s) => s.pending);
  const error = store((s) => s.error);

  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('');
  const [mood, setMood] = useState('');
  const [complexity, setComplexity] = useState<NonNullable<GenerateScoreRequest['complexity']>>('moderate');
  const [instruments, setInstruments] = useState<Set<InstrumentKey>>(() => new Set(['piano']));
  const [measures, setMeasures] = useState(String(DEFAULT_MEASURES));
  const [tempo, setTempo] = useState('');
  const [keyFifths, setKeyFifths] = useState(0);
  const [keyMode, setKeyMode] = useState<KeySignature['mode']>('major');
  const [timeSigPreset, setTimeSigPreset] = useState('4/4');
  const [presetAnchor, setPresetAnchor] = useState<HTMLElement | null>(null);

  const durationMeasures = Number(measures);
  const tracks = INSTRUMENT_OPTIONS.filter((opt) => instruments.has(opt.key)).map(toRequestTrack);
  const canGenerate =
    !pending && prompt.trim() !== '' && tracks.length > 0 && Number.isFinite(durationMeasures) && durationMeasures > 0;

  const toggleInstrument = (key: InstrumentKey): void => {
    setInstruments((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePresetSelect = (text: string): void => {
    setPrompt(text);
    setPresetAnchor(null);
  };

  const handleGenerate = (): void => {
    if (!canGenerate) return;
    const request: GenerateScoreRequest = {
      prompt,
      durationMeasures,
      tracks,
      complexity,
      timeSignature: TIME_SIGNATURE_OPTIONS[timeSigPreset],
      keySignature: { fifths: keyFifths, mode: keyMode },
      ...(style && { style }),
      ...(mood && { mood }),
      ...(tempo.trim() !== '' && Number.isFinite(Number(tempo)) && { tempo: Number(tempo) }),
    };
    void store.getState().generate(request);
  };

  const handleCancel = (): void => {
    store.getState().cancel();
  };

  return (
    <Stack spacing={2} sx={{ p: 2 }} aria-label="Generation panel">
      <Typography variant="subtitle1">Generate a new score</Typography>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          multiline
          minRows={3}
          fullWidth
          label="Prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Prompt' } }}
        />
        <Button size="small" aria-label="Preset prompts" onClick={(e) => setPresetAnchor(e.currentTarget)}>
          Presets
        </Button>
        <Menu anchorEl={presetAnchor} open={presetAnchor !== null} onClose={() => setPresetAnchor(null)}>
          {PRESET_PROMPTS.map((text) => (
            <MenuItem key={text} onClick={() => handlePresetSelect(text)}>
              {text}
            </MenuItem>
          ))}
        </Menu>
      </Stack>

      <Stack direction="row" spacing={1}>
        <Select
          size="small"
          fullWidth
          displayEmpty
          value={style}
          onChange={(e: SelectChangeEvent) => setStyle(e.target.value)}
          inputProps={{ 'aria-label': 'Style' }}
        >
          <MenuItem value="">
            <em>No style</em>
          </MenuItem>
          {STYLE_OPTIONS.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          fullWidth
          displayEmpty
          value={mood}
          onChange={(e: SelectChangeEvent) => setMood(e.target.value)}
          inputProps={{ 'aria-label': 'Mood' }}
        >
          <MenuItem value="">
            <em>No mood</em>
          </MenuItem>
          {MOOD_OPTIONS.map((m) => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          fullWidth
          value={complexity}
          onChange={(e: SelectChangeEvent) =>
            setComplexity(e.target.value as NonNullable<GenerateScoreRequest['complexity']>)
          }
          inputProps={{ 'aria-label': 'Complexity' }}
        >
          {COMPLEXITY_OPTIONS.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </Select>
      </Stack>

      <Box role="group" aria-label="Instrumentation">
        <Typography variant="body2">Instrumentation</Typography>
        <FormGroup row>
          {INSTRUMENT_OPTIONS.map((opt) => (
            <FormControlLabel
              key={opt.key}
              control={
                <Checkbox
                  size="small"
                  checked={instruments.has(opt.key)}
                  onChange={() => toggleInstrument(opt.key)}
                  slotProps={{ input: { 'aria-label': `Include ${opt.label}` } }}
                />
              }
              label={opt.label}
            />
          ))}
        </FormGroup>
      </Box>

      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          type="number"
          label="Measures"
          value={measures}
          onChange={(e) => setMeasures(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Measures', min: 1 } }}
        />
        <TextField
          size="small"
          type="number"
          label="Tempo"
          value={tempo}
          onChange={(e) => setTempo(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Tempo', min: 1 } }}
        />
      </Stack>

      <Stack direction="row" spacing={1}>
        <Select
          size="small"
          fullWidth
          value={keyFifths}
          onChange={(e: SelectChangeEvent<number>) => setKeyFifths(Number(e.target.value))}
          inputProps={{ 'aria-label': 'Key' }}
        >
          {KEY_FIFTHS_OPTIONS.map((opt) => (
            <MenuItem key={opt.fifths} value={opt.fifths}>
              {opt.label}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          fullWidth
          value={keyMode}
          onChange={(e: SelectChangeEvent) => setKeyMode(e.target.value as KeySignature['mode'])}
          inputProps={{ 'aria-label': 'Mode' }}
        >
          <MenuItem value="major">major</MenuItem>
          <MenuItem value="minor">minor</MenuItem>
        </Select>
        <Select
          size="small"
          fullWidth
          value={timeSigPreset}
          onChange={(e: SelectChangeEvent) => setTimeSigPreset(e.target.value)}
          inputProps={{ 'aria-label': 'Time signature' }}
        >
          {Object.keys(TIME_SIGNATURE_OPTIONS).map((key) => (
            <MenuItem key={key} value={key}>
              {key}
            </MenuItem>
          ))}
        </Select>
      </Stack>

      {pending && <LinearProgress aria-label="Generating" />}

      <Stack direction="row" spacing={1}>
        <Button variant="contained" aria-label="Generate" disabled={!canGenerate} onClick={handleGenerate}>
          Generate
        </Button>
        {pending && (
          <Button aria-label="Cancel" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
