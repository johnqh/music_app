/**
 * One modal for all three Replace actions, parameterised by scope.
 *
 * Settings only. Submitting starts a background job and closes — there is no
 * candidate list and no accept step, because the result lands minutes later
 * when the person who asked for it is very likely elsewhere.
 *
 * Absent on purpose: instrumentation, measure count, tempo, key and time
 * signature. All of those are fixed by the region being replaced, and a
 * disabled control that can never apply is worse than no control.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Button,
  Checkbox,
  FormModal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextArea,
  cn,
} from '@sudobility/components';
import { variants } from '@sudobility/design';
import type { ReplaceScope, ReplacementRegion } from '@sudobility/music_lib';

export type ReplaceSubmission = {
  instruction: string;
  style?: string;
  mood?: string;
  complexity?: 'simple' | 'moderate' | 'complex';
  constraints: {
    preserveBoundaryNotes: boolean;
    preserveHarmony: boolean;
    preserveRhythm: boolean;
    preserveMelody: boolean;
  };
};

export type ReplaceMusicDialogProps = {
  open: boolean;
  scope: ReplaceScope;
  /** What will be overwritten. `null` disables submission. */
  region: ReplacementRegion | null;
  /** Name of the track being replaced, for the summary line. */
  trackLabel?: string;
  onClose: () => void;
  onSubmit: (submission: ReplaceSubmission) => void;
};

const TITLES: Record<ReplaceScope, string> = {
  notes: 'Replace Notes',
  measures: 'Replace Measures',
  track: 'Replace Track',
};

/** Spec §12, verbatim — lifted from the retired RegenerationPanel. */
const PRESET_INSTRUCTIONS: string[] = [
  'Make this more dramatic',
  'Simplify this passage',
  'Add rhythmic variation',
  'Make the melody more memorable',
  'Create a stronger transition',
  'Add harmonic tension',
  'Resolve the phrase',
  'Make this more upbeat',
  'Make this darker',
  'Create a variation while preserving the melody',
  'Preserve rhythm but change harmony',
  'Preserve harmony but change melody',
  'Add accompaniment',
  'Thin out the orchestration',
];

/** Matches `prompt-parse.ts`'s keywords; anything else is ignored by the model prompt. */
const STYLE_OPTIONS = ['waltz', 'jazz', 'pop', 'cinematic', 'ambient', 'battle'];
const MOOD_OPTIONS = ['gentle', 'dark', 'upbeat', 'dramatic', 'calm', 'energetic'];
const COMPLEXITY_OPTIONS = ['simple', 'moderate', 'complex'] as const;

/** Radix Select rejects an empty-string item value, so "no preference" needs a sentinel. */
const NONE = '__none__';

const SELECT_CLASS = 'h-auto w-full justify-between px-2 py-1.5 text-sm';

/**
 * What is about to be overwritten.
 *
 * Takes `t` rather than calling a hook: this is a plain function, and the
 * counts pluralise through i18next rather than by appending an "s", which only
 * works in English.
 */
function summarise(
  region: ReplacementRegion,
  trackLabel: string | undefined,
  t: TFunction,
): string {
  const tracks = region.range.trackIds.length;
  const where =
    trackLabel && tracks === 1
      ? t('replace.onTrack', { name: trackLabel })
      : t('replace.onTracks', { count: tracks });
  return t('replace.summary', { count: region.noteCount, where });
}

export function ReplaceMusicDialog({
  open,
  scope,
  region,
  trackLabel,
  onClose,
  onSubmit,
}: ReplaceMusicDialogProps) {
  const { t } = useTranslation();
  const [instruction, setInstruction] = useState('');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [style, setStyle] = useState(NONE);
  const [mood, setMood] = useState(NONE);
  const [complexity, setComplexity] = useState<string>('moderate');
  const [preserveBoundaryNotes, setPreserveBoundaryNotes] = useState(false);
  const [preserveHarmony, setPreserveHarmony] = useState(false);
  const [preserveRhythm, setPreserveRhythm] = useState(false);
  const [preserveMelody, setPreserveMelody] = useState(false);

  // Reopening for a different selection should not inherit the last one's
  // instruction, which would silently apply to music it was not written for.
  useEffect(() => {
    if (open) {
      setInstruction('');
      setPresetsOpen(false);
    }
  }, [open, scope]);

  const submit = (): void => {
    const trimmed = instruction.trim();
    if (trimmed.length === 0 || !region) return;
    onSubmit({
      instruction: trimmed,
      ...(style !== NONE ? { style } : {}),
      ...(mood !== NONE ? { mood } : {}),
      complexity: complexity as ReplaceSubmission['complexity'],
      constraints: { preserveBoundaryNotes, preserveHarmony, preserveRhythm, preserveMelody },
    });
  };

  return (
    <FormModal
      open={open}
      title={TITLES[scope]}
      onClose={onClose}
      size="small"
      closeAriaLabel={t('common.closeDialog')}
      actions={[
        { label: t('common.cancel'), onClick: onClose, variant: 'ghost' },
        {
          label: t('replace.action'),
          onClick: submit,
          variant: 'primary',
          disabled: !region || instruction.trim().length === 0,
        },
      ]}
    >
      <div className="flex flex-col gap-4">
        {region && (
          <p className="text-sm text-theme-text-primary">
            {summarise(region, trackLabel, t)}
            {region.unselectedNoteCount > 0 && (
              // Said up front rather than discovered afterwards: a
              // non-contiguous selection is replaced as its bounding span.
              <span className="text-amber-700 dark:text-amber-400">
                {' '}
                {region.unselectedNoteCount} of them{' '}
                {region.unselectedNoteCount === 1 ? 'is' : 'are'} not selected.
              </span>
            )}
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-theme-text-secondary">{t('replace.instruction')}</span>
          <TextArea
            value={instruction}
            onChange={(v: string) => setInstruction(v)}
            rows={3}
            textareaProps={{ 'aria-label': 'Instruction' }}
          />
        </label>

        <div className="relative">
          <Button
            type="button"
            variant="outline"
            aria-label={t('replace.presetInstructions')}
            aria-haspopup="menu"
            onClick={() => setPresetsOpen((v) => !v)}
            className="px-3 py-1.5 text-sm"
          >
            {t('generate.presets')}
          </Button>
          {presetsOpen && (
            <div
              role="menu"
              className={cn(
                variants.card.default.base(),
                'absolute z-10 mt-1 max-h-56 w-64 overflow-y-auto rounded-md py-1 shadow-lg',
              )}
            >
              {PRESET_INSTRUCTIONS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  role="menuitem"
                  variant="ghost"
                  onClick={() => {
                    setInstruction(preset);
                    setPresetsOpen(false);
                  }}
                  className="w-full justify-start px-3 py-1.5 text-left text-sm"
                >
                  {preset}
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-theme-text-secondary">{t('generateScore.style')}</span>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger aria-label={t('generateScore.style')} className={SELECT_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('generateScore.noStyle')}</SelectItem>
                {STYLE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-theme-text-secondary">{t('generateScore.mood')}</span>
            <Select value={mood} onValueChange={setMood}>
              <SelectTrigger aria-label={t('generateScore.mood')} className={SELECT_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('generateScore.noMood')}</SelectItem>
                {MOOD_OPTIONS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-theme-text-secondary">{t('generateScore.complexity')}</span>
          <Select value={complexity} onValueChange={setComplexity}>
            <SelectTrigger aria-label={t('generateScore.complexity')} className={SELECT_CLASS}>
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
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Checkbox
            label={t('replace.preserveBoundary')}
            checked={preserveBoundaryNotes}
            onChange={setPreserveBoundaryNotes}
          />
          <Checkbox
            label={t('replace.preserveHarmony')}
            checked={preserveHarmony}
            onChange={setPreserveHarmony}
          />
          <Checkbox
            label={t('replace.preserveRhythm')}
            checked={preserveRhythm}
            onChange={setPreserveRhythm}
          />
          <Checkbox
            label={t('replace.preserveMelody')}
            checked={preserveMelody}
            onChange={setPreserveMelody}
          />
        </div>
      </div>
    </FormModal>
  );
}
