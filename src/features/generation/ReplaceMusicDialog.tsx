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
import { useEffect, useMemo, useState } from 'react';
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
import {
  GENERATE_SCORE_COMPLEXITY_OPTIONS,
  GENERATE_SCORE_MOOD_OPTIONS,
  GENERATE_SCORE_STYLE_OPTIONS,
  GENERATION_VARIANTS,
  GENERATION_VARIANT_LABELS,
  REPLACE_PRESET_KEYS,
  buildReplaceSubmission,
  complexityLabelKey,
  defaultReplaceSubmission,
  labelledOptions,
  moodLabelKey,
  optionalFromPicker,
  optionalToPicker,
  replacePresetLabelKey,
  styleLabelKey,
  type GenerateScoreComplexity,
  type ReplaceDraft,
} from '@sudobility/music_lib';
import type { ReplaceScope, ReplaceSubmission, ReplacementRegion } from '@sudobility/music_lib';

// `ReplaceSubmission` now lives in music_lib beside `prepareReplacement`,
// which turns it into a request: the shape of what is asked for is part of
// asking, not part of the dialog that collects it.
export type { ReplaceSubmission } from '@sudobility/music_lib';

export type ReplaceMusicDialogProps = {
  open: boolean;
  scope: ReplaceScope;
  /** What will be overwritten. `null` disables submission. */
  region: ReplacementRegion | null;
  /** Name of the track being replaced, for the summary line. */
  trackLabel?: string;
  onClose: () => void;
  onSubmit: (submission: ReplaceSubmission) => void;
  /** The bars the region touches times its tracks: what the server bills. */
  estimatedCredits?: number;
};

/**
 * The locale key naming each scope.
 *
 * Keys rather than the words: a `Record` of literal English strings renders as
 * English in the Chinese build, which is exactly the failure `locale-parity`
 * exists to catch and cannot see — it compares the locale files, not the code.
 */
const TITLE_KEYS: Record<ReplaceScope, string> = {
  notes: 'replace.notesTitle',
  measures: 'replace.measuresTitle',
  track: 'replace.trackTitle',
};

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
  estimatedCredits = 0,
}: ReplaceMusicDialogProps) {
  const { t, i18n } = useTranslation();
  /*
    The form's defaults and what it submits are music_lib's
    (`defaultReplaceSubmission`/`buildReplaceSubmission`), shared with the
    native form — which had opened on different defaults, so the same
    instruction over the same bars sent two different requests depending on
    which device asked.
  */
  const [draft, setDraft] = useState<ReplaceDraft>(defaultReplaceSubmission);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const patch = (next: Partial<ReplaceDraft>): void => setDraft((d) => ({ ...d, ...next }));
  const setConstraint =
    (key: keyof ReplaceDraft['constraints']) =>
    (checked: boolean): void =>
      setDraft((d) => ({ ...d, constraints: { ...d.constraints, [key]: checked } }));

  // Reopening for a different selection should not inherit the last one's
  // instruction, which would silently apply to music it was not written for.
  useEffect(() => {
    if (open) {
      setDraft((d) => ({ ...d, instruction: '' }));
      setPresetsOpen(false);
    }
  }, [open, scope]);

  /*
    The whole style and mood vocabularies, translated and sorted, as New Project
    offers them. This form used to carry its own six-of-each list in raw English
    tokens (`cinematic`), stale beside the thirty-odd styles the server knows.
  */
  const styleOptions = useMemo(
    () =>
      labelledOptions(
        GENERATE_SCORE_STYLE_OPTIONS,
        (value) => t(styleLabelKey(value)),
        i18n.language,
        t('generateScore.noStyle'),
      ),
    [t, i18n.language],
  );
  const moodOptions = useMemo(
    () =>
      labelledOptions(
        GENERATE_SCORE_MOOD_OPTIONS,
        (value) => t(moodLabelKey(value)),
        i18n.language,
        t('generateScore.noMood'),
      ),
    [t, i18n.language],
  );

  const submission = buildReplaceSubmission(draft);
  const submit = (): void => {
    if (!submission || !region) return;
    onSubmit(submission);
  };

  return (
    <FormModal
      open={open}
      title={t(TITLE_KEYS[scope])}
      onClose={onClose}
      size="small"
      closeAriaLabel={t('common.closeDialog')}
      actions={[
        { label: t('common.cancel'), onClick: onClose, variant: 'ghost' },
        {
          label: t('replace.action'),
          onClick: submit,
          variant: 'primary',
          disabled: !region || !submission,
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
                {t('replace.unselected', { count: region.unselectedNoteCount })}
              </span>
            )}
          </p>
        )}
        {region && estimatedCredits > 0 && (
          <p className="text-xs text-theme-text-secondary">
            {t('generate.estimate', { count: estimatedCredits })}
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-theme-text-secondary">{t('replace.instruction')}</span>
          <TextArea
            value={draft.instruction}
            onChange={(v: string) => patch({ instruction: v })}
            rows={3}
            textareaProps={{ 'aria-label': t('replace.instruction') }}
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
              {/* In the reader's language: the chosen text is the instruction
                  the model is asked, and the model reads Chinese as well. */}
              {REPLACE_PRESET_KEYS.map((key) => (
                <Button
                  key={key}
                  type="button"
                  role="menuitem"
                  variant="ghost"
                  onClick={() => {
                    patch({ instruction: t(replacePresetLabelKey(key)) });
                    setPresetsOpen(false);
                  }}
                  className="w-full justify-start px-3 py-1.5 text-left text-sm"
                >
                  {t(replacePresetLabelKey(key))}
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-theme-text-secondary">{t('generateScore.style')}</span>
            <Select
              value={optionalToPicker(draft.style)}
              onValueChange={(v) => patch({ style: optionalFromPicker(v) })}
            >
              <SelectTrigger aria-label={t('generateScore.style')} className={SELECT_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {styleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-theme-text-secondary">{t('generateScore.mood')}</span>
            <Select
              value={optionalToPicker(draft.mood)}
              onValueChange={(v) => patch({ mood: optionalFromPicker(v) })}
            >
              <SelectTrigger aria-label={t('generateScore.mood')} className={SELECT_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {moodOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-theme-text-secondary">{t('generateScore.complexity')}</span>
          <Select
            value={draft.complexity}
            onValueChange={(v) => patch({ complexity: v as GenerateScoreComplexity })}
          >
            <SelectTrigger aria-label={t('generateScore.complexity')} className={SELECT_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GENERATE_SCORE_COMPLEXITY_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(complexityLabelKey(c))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-theme-text-secondary">{t('generateScore.model')}</span>
          <Select value={draft.variant} onValueChange={(v) => patch({ variant: v })}>
            <SelectTrigger aria-label={t('generateScore.model')} className={SELECT_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GENERATION_VARIANTS.map((v) => (
                <SelectItem key={v} value={v}>
                  {GENERATION_VARIANT_LABELS[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Checkbox
            label={t('replace.preserveBoundary')}
            checked={draft.constraints.preserveBoundaryNotes}
            onChange={setConstraint('preserveBoundaryNotes')}
          />
          <Checkbox
            label={t('replace.preserveHarmony')}
            checked={draft.constraints.preserveHarmony}
            onChange={setConstraint('preserveHarmony')}
          />
          <Checkbox
            label={t('replace.preserveRhythm')}
            checked={draft.constraints.preserveRhythm}
            onChange={setConstraint('preserveRhythm')}
          />
          <Checkbox
            label={t('replace.preserveMelody')}
            checked={draft.constraints.preserveMelody}
            onChange={setConstraint('preserveMelody')}
          />
        </div>
      </div>
    </FormModal>
  );
}
