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
 *
 * Adopts `@sudobility/components` controls (library sweep 2): the prompt
 * `<textarea>` becomes the library `TextArea` (its accessible name goes
 * through `textareaProps={{ 'aria-label': ... }}`, since `TextArea` has no
 * top-level `aria-label` prop); the Style/Mood/Complexity/Key/Mode/Time-
 * signature `<select>`s become the library's Radix-backed `Select`
 * (Style/Mood need a non-empty sentinel value, `NONE_VALUE`, for their "No
 * style"/"No mood" option -- Radix `Select.Item` rejects an empty-string
 * value); Measures/Tempo become the library `Input`; the Presets
 * trigger/menuitem buttons and Generate/Cancel become the library `Button`
 * (the popover itself stays a hand-built `role="menu"` div, same reasoning
 * as `EditorToolbar`'s articulation menu: no library Dropdown/Command
 * reproduces `menu`/`menuitem` roles).
 *
 * The instrumentation checklist becomes the library `Checkbox`, which
 * (unlike `Select`) renders a real native `<input type="checkbox">` with
 * the same `role="checkbox"` semantics as before, so no interaction-style
 * test changes are needed there -- but `Checkbox` has no `aria-label` prop
 * at all (only a visible `label` string used for both display *and* the
 * native `<label>`-association that supplies its accessible name), so
 * preserving the exact "Include <Instrument>" accessible name means that
 * text now shows up on screen too (previously "Include Piano" was an
 * aria-label with only "Piano" visible).
 *
 * The `role="progressbar"` div stays native: neither the library `Progress`
 * nor `ProgressBar` accepts an `aria-label` (or anything else) on the
 * element that actually carries `role="progressbar"`, so there's no way to
 * keep the required "Generating" accessible name on a library swap.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBalance } from '@sudobility/consumables_client';
import type { ChangeEvent } from 'react';
import {
  Button,
  FormModal,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextArea,
  cn,
} from '@sudobility/components';
import { variants } from '@sudobility/design';

import type { Clef, KeySignature, TimeSignature } from '@sudobility/music_types';
import type { GenerateScoreRequest, GenerateScoreRequestTrack } from '@sudobility/music_types';

export type GenerateScoreDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Receives the assembled request; the dashboard creates the project and starts the job. */
  onSubmit: (request: GenerateScoreRequest) => void;
  /** True while the project is being created, to disable the CTA. */
  submitting?: boolean;
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
const COMPLEXITY_OPTIONS: NonNullable<GenerateScoreRequest['complexity']>[] = [
  'simple',
  'moderate',
  'complex',
];

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
const INSTRUMENT_OPTIONS: Array<{
  key: InstrumentKey;
  label: string;
  instrumentName: string;
  midiProgram: number;
  clef: Clef;
}> = [
  { key: 'piano', label: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' },
  {
    key: 'electric-piano',
    label: 'Electric Piano',
    instrumentName: 'Electric Piano',
    midiProgram: 4,
    clef: 'treble',
  },
  { key: 'strings', label: 'Strings', instrumentName: 'Strings', midiProgram: 48, clef: 'treble' },
  { key: 'bass', label: 'Bass', instrumentName: 'Bass', midiProgram: 32, clef: 'bass' },
  {
    key: 'synth-lead',
    label: 'Synth Lead',
    instrumentName: 'Synth Lead',
    midiProgram: 80,
    clef: 'treble',
  },
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

/** Sentinel for Style/Mood's "no selection" option: Radix `Select.Item` rejects an empty-string `value` (it's reserved to mean "cleared"). */
const NONE_VALUE = '__none__';

function toRequestTrack(option: (typeof INSTRUMENT_OPTIONS)[number]): GenerateScoreRequestTrack {
  return {
    name: option.label,
    instrumentName: option.instrumentName,
    midiProgram: option.midiProgram,
    clef: option.clef,
  };
}

const SELECT_TRIGGER_CLASS = 'h-auto w-full justify-between px-2 py-1.5 text-sm';

const TEXT_INPUT_CLASS = 'w-full px-2 py-1.5 text-sm';

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
      <Input
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

export function GenerateScoreDialog({
  open,
  onClose,
  onSubmit,
  submitting = false,
}: GenerateScoreDialogProps) {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('');
  const [mood, setMood] = useState('');
  const [complexity, setComplexity] =
    useState<NonNullable<GenerateScoreRequest['complexity']>>('moderate');
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

  const { balance } = useBalance();
  /**
   * Bars times instruments: what the request asks for, and what the server
   * bills. A four-bar quartet costs about four times a four-bar solo to
   * produce, so an estimate from the bar count alone would understate every
   * wide score four-fold.
   *
   * The charge counts what the model actually *produced*, which agrees whenever
   * generation returns the requested length and is otherwise smaller — so this
   * is never exceeded. Hence "about", and never a re-quote afterwards.
   */
  const estimatedCredits = Number.isFinite(durationMeasures)
    ? Math.max(0, durationMeasures) * tracks.length
    : 0;
  /**
   * Refused only at zero or below, matching `POST /jobs`.
   *
   * Deliberately not `estimatedCredits > balance`: a job may overdraw once by
   * design, and a stricter rule here would refuse work the API would accept.
   */
  const outOfCredits = balance !== null && balance <= 0;

  const canGenerate =
    !submitting &&
    !outOfCredits &&
    prompt.trim() !== '' &&
    tracks.length > 0 &&
    Number.isFinite(durationMeasures) &&
    durationMeasures > 0;

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
      ...(title.trim() !== '' && { title: title.trim() }),
      durationMeasures,
      tracks,
      complexity,
      timeSignature: TIME_SIGNATURE_OPTIONS[timeSigPreset],
      keySignature: { fifths: keyFifths, mode: keyMode },
      ...(style && { style }),
      ...(mood && { mood }),
      ...(tempo.trim() !== '' && Number.isFinite(Number(tempo)) && { tempo: Number(tempo) }),
    };
    onSubmit(request);
  };

  return (
    <FormModal
      open={open}
      title="Generate a new score"
      onClose={onClose}
      size="large"
      closeAriaLabel="Close dialog"
      actions={[
        { label: 'Cancel', onClick: onClose, variant: 'ghost' },
        {
          label: 'Generate',
          onClick: handleGenerate,
          variant: 'primary',
          disabled: !canGenerate,
          loading: submitting,
          loadingLabel: 'Creating…',
        },
      ]}
    >
      <div className="flex flex-col gap-4">
        {outOfCredits ? (
          <p className="text-sm text-theme-text-secondary">
            You&rsquo;re out of credits.{' '}
            <Link to="/en/credits" className="underline">
              Buy more
            </Link>{' '}
            to keep generating.
          </p>
        ) : (
          estimatedCredits > 0 && (
            <p className="text-xs text-theme-text-secondary">
              This will use about {estimatedCredits} credits.
            </p>
          )
        )}

        {/* Named up front: every generated project would otherwise be called
          "Generated score", which is useless the moment you have two. */}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-theme-text-secondary">Title</span>
          <Input
            value={title}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            placeholder="Generated score"
            aria-label="Title"
            className="px-2 py-1.5 text-sm"
          />
        </label>

        <div className="flex items-start gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-theme-text-secondary">Prompt</span>
            <TextArea
              value={prompt}
              onChange={setPrompt}
              rows={3}
              textareaProps={{ 'aria-label': 'Prompt' }}
            />
          </label>
          <div ref={presetRef} className="relative shrink-0">
            <Button
              type="button"
              variant="outline"
              aria-label="Preset prompts"
              aria-haspopup="menu"
              aria-expanded={presetOpen}
              onClick={() => setPresetOpen((open) => !open)}
              className="px-3 py-1.5"
            >
              Presets
            </Button>
            {presetOpen && (
              <div
                role="menu"
                className={cn(
                  variants.card.default.base(),
                  'absolute right-0 top-full z-10 mt-1 max-h-72 w-80 overflow-y-auto rounded-md py-1 shadow-lg',
                )}
              >
                {PRESET_PROMPTS.map((text) => (
                  <Button
                    key={text}
                    type="button"
                    variant="ghost"
                    role="menuitem"
                    onClick={() => handlePresetSelect(text)}
                    className="block w-full justify-start rounded-none px-3 py-1.5 text-left"
                  >
                    {text}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Select
            value={style === '' ? NONE_VALUE : style}
            onValueChange={(v) => setStyle(v === NONE_VALUE ? '' : v)}
          >
            <SelectTrigger aria-label="Style" className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>No style</SelectItem>
              {STYLE_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={mood === '' ? NONE_VALUE : mood}
            onValueChange={(v) => setMood(v === NONE_VALUE ? '' : v)}
          >
            <SelectTrigger aria-label="Mood" className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>No mood</SelectItem>
              {MOOD_OPTIONS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={complexity}
            onValueChange={(v) =>
              setComplexity(v as NonNullable<GenerateScoreRequest['complexity']>)
            }
          >
            <SelectTrigger aria-label="Complexity" className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPLEXITY_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div role="group" aria-label="Instrumentation" className="flex flex-col gap-2">
          <span className="text-sm text-theme-text-primary">Instrumentation</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {INSTRUMENT_OPTIONS.map((opt) => (
              <Checkbox
                key={opt.key}
                label={`Include ${opt.label}`}
                checked={instruments.has(opt.key)}
                onChange={() => toggleInstrument(opt.key)}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <LabeledInput label="Measures" value={measures} onChange={setMeasures} min={1} />
          <LabeledInput label="Tempo" value={tempo} onChange={setTempo} min={1} />
        </div>

        <div className="flex gap-2">
          <Select value={String(keyFifths)} onValueChange={(v) => setKeyFifths(Number(v))}>
            <SelectTrigger aria-label="Key" className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KEY_FIFTHS_OPTIONS.map((opt) => (
                <SelectItem key={opt.fifths} value={String(opt.fifths)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={keyMode} onValueChange={(v) => setKeyMode(v as KeySignature['mode'])}>
            <SelectTrigger aria-label="Mode" className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="major">major</SelectItem>
              <SelectItem value="minor">minor</SelectItem>
            </SelectContent>
          </Select>
          <Select value={timeSigPreset} onValueChange={setTimeSigPreset}>
            <SelectTrigger
              aria-label="Time signature"
              className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(TIME_SIGNATURE_OPTIONS).map((key) => (
                <SelectItem key={key} value={key}>
                  {key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </FormModal>
  );
}
