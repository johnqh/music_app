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
 *
 * Re-skinned onto Tailwind (T12 batch 4): the MUI Select becomes native
 * `<select>`s, the MUI Menu becomes a small `role="menu"`/`role="menuitem"`
 * popover built from plain buttons (same pattern as `EditorToolbar`'s
 * articulation menu), MUI Checkboxes become native `<input
 * type="checkbox">`s, and MUI LinearProgress becomes a `role="progressbar"`
 * div — same roles/labels/accessible names as before, so no test
 * assertions changed.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

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

const TEXT_BUTTON_CLASS =
  'rounded-md border border-theme-border px-3 py-1.5 text-sm text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-40';

const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';

const SELECT_CLASS =
  'w-full rounded-md border border-theme-border bg-theme-bg-primary px-2 py-1.5 text-sm text-theme-text-primary';

const TEXT_INPUT_CLASS =
  'w-full rounded-md border border-theme-border bg-theme-bg-primary px-2 py-1.5 text-sm text-theme-text-primary';

function LabeledInput({
  label,
  value,
  onChange,
  min,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  className?: string;
}) {
  return (
    <label className={`flex flex-1 flex-col gap-1 ${className ?? ''}`}>
      <span className="text-xs text-theme-text-secondary">{label}</span>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className={TEXT_INPUT_CLASS}
      />
    </label>
  );
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
  const [presetOpen, setPresetOpen] = useState(false);
  const presetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!presetOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!presetRef.current?.contains(event.target as Node)) setPresetOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [presetOpen]);

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
    setPresetOpen(false);
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
    <div aria-label="Generation panel" className="flex flex-col gap-4 p-4">
      <h3 className="text-sm font-semibold text-theme-text-primary">Generate a new score</h3>

      {error && (
        <div role="alert" className="rounded-md bg-red-600 px-3 py-2 text-sm text-white">
          {error}
        </div>
      )}

      <div className="flex items-start gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-theme-text-secondary">Prompt</span>
          <textarea
            aria-label="Prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className={TEXT_INPUT_CLASS}
          />
        </label>
        <div ref={presetRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Preset prompts"
            aria-haspopup="menu"
            aria-expanded={presetOpen}
            onClick={() => setPresetOpen((open) => !open)}
            className={TEXT_BUTTON_CLASS}
          >
            Presets
          </button>
          {presetOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-theme-border bg-theme-bg-secondary py-1 shadow-lg"
            >
              {PRESET_PROMPTS.map((text) => (
                <button
                  key={text}
                  type="button"
                  role="menuitem"
                  onClick={() => handlePresetSelect(text)}
                  className="block w-full px-3 py-1.5 text-left text-sm text-theme-text-primary hover:bg-theme-hover-bg"
                >
                  {text}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <select
          aria-label="Style"
          value={style}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setStyle(e.target.value)}
          className={`${SELECT_CLASS} flex-1`}
        >
          <option value="">No style</option>
          {STYLE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Mood"
          value={mood}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setMood(e.target.value)}
          className={`${SELECT_CLASS} flex-1`}
        >
          <option value="">No mood</option>
          {MOOD_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          aria-label="Complexity"
          value={complexity}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            setComplexity(e.target.value as NonNullable<GenerateScoreRequest['complexity']>)
          }
          className={`${SELECT_CLASS} flex-1`}
        >
          {COMPLEXITY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div role="group" aria-label="Instrumentation" className="flex flex-col gap-2">
        <span className="text-sm text-theme-text-primary">Instrumentation</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {INSTRUMENT_OPTIONS.map((opt) => (
            <label key={opt.key} className="flex items-center gap-2 text-sm text-theme-text-primary">
              <input
                type="checkbox"
                aria-label={`Include ${opt.label}`}
                checked={instruments.has(opt.key)}
                onChange={() => toggleInstrument(opt.key)}
                className="h-4 w-4 rounded border-theme-border"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <LabeledInput label="Measures" value={measures} onChange={setMeasures} min={1} />
        <LabeledInput label="Tempo" value={tempo} onChange={setTempo} min={1} />
      </div>

      <div className="flex gap-2">
        <select
          aria-label="Key"
          value={keyFifths}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setKeyFifths(Number(e.target.value))}
          className={`${SELECT_CLASS} flex-1`}
        >
          {KEY_FIFTHS_OPTIONS.map((opt) => (
            <option key={opt.fifths} value={opt.fifths}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Mode"
          value={keyMode}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setKeyMode(e.target.value as KeySignature['mode'])}
          className={`${SELECT_CLASS} flex-1`}
        >
          <option value="major">major</option>
          <option value="minor">minor</option>
        </select>
        <select
          aria-label="Time signature"
          value={timeSigPreset}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setTimeSigPreset(e.target.value)}
          className={`${SELECT_CLASS} flex-1`}
        >
          {Object.keys(TIME_SIGNATURE_OPTIONS).map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </div>

      {pending && (
        <div role="progressbar" aria-label="Generating" className="h-1 w-full overflow-hidden rounded-full bg-theme-bg-secondary">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" aria-label="Generate" disabled={!canGenerate} onClick={handleGenerate} className={PRIMARY_BUTTON_CLASS}>
          Generate
        </button>
        {pending && (
          <button type="button" aria-label="Cancel" onClick={handleCancel} className={TEXT_BUTTON_CLASS}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
