/**
 * Generating one track with AI and adding it to the open score.
 *
 * A prompt box plus an instrument, because the generation request needs a GM
 * program and clef regardless — defaulting silently to Piano would answer
 * "add a bass line" with a piano-programmed track, which reads as the feature
 * being broken rather than under-specified.
 *
 * The instrument menu comes from the shared catalog: all 128 GM programs
 * grouped by family, and the eight drum kits ahead of them.
 *
 * `FormModal` rather than `Dialog`: full-screen on a phone, centred dialog
 * from `sm` up, with the title bar and sticky confirm button supplied.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FormModal,
  InfoBox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  TextArea,
} from '@sudobility/components';
import {
  DEFAULT_INSTRUMENT_VALUE,
  GENERATION_VARIANTS,
  GENERATION_VARIANT_LABELS,
  instrumentChoiceFor,
  type InstrumentChoice,
} from '@sudobility/music_lib';
import { InstrumentSelectItems } from '@/features/instruments/InstrumentSelectItems';

export type GenerateTrackDialogProps = {
  open: boolean;
  pending: boolean;
  error?: string | null;
  onGenerate: (prompt: string, instrument: InstrumentChoice, variant: string) => void;
  onClose: () => void;
};

export function GenerateTrackDialog({
  open,
  pending,
  error,
  onGenerate,
  onClose,
}: GenerateTrackDialogProps) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [value, setValue] = useState(DEFAULT_INSTRUMENT_VALUE);
  // The same default the Generate and Replace dialogs use. Not remembered
  // across openings on purpose: it is a per-call choice, and the setting that
  // does persist is the developer one behind it.
  const [variant, setVariant] = useState<string>('deepseek');

  useEffect(() => {
    if (open) setPrompt('');
  }, [open]);

  const trimmed = prompt.trim();

  return (
    <FormModal
      open={open}
      title={t('generateTrack.title')}
      onClose={onClose}
      onSave={() => onGenerate(trimmed, instrumentChoiceFor(value), variant)}
      saving={pending}
      canSave={trimmed.length > 0}
      saveLabel={t('generate.action')}
      size="small"
    >
      <Stack direction="vertical" spacing="md">
        <Text as="p" size="sm" color="muted">
          {t('generateTrack.intro')}
        </Text>

        <Stack direction="vertical" spacing="xs">
          <Text as="label" size="sm" color="muted">
            {t('generateTrack.promptLabel')}
          </Text>
          <TextArea
            rows={3}
            value={prompt}
            onChange={(next) => setPrompt(next)}
            placeholder={t('generateTrack.promptPlaceholder')}
            textareaProps={{ 'aria-label': t('generate.prompt') }}
          />
        </Stack>

        <Stack direction="vertical" spacing="xs">
          <Text as="label" size="sm" color="muted">
            {t('generate.instrument')}
          </Text>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger aria-label={t('generate.instrument')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <InstrumentSelectItems />
            </SelectContent>
          </Select>
        </Stack>

        <Stack direction="vertical" spacing="xs">
          <Text as="label" size="sm" color="muted">
            {t('generateScore.model')}
          </Text>
          <Select value={variant} onValueChange={setVariant}>
            <SelectTrigger aria-label={t('generateScore.model')}>
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
        </Stack>

        {error && (
          <InfoBox variant="danger" size="sm">
            {error}
          </InfoBox>
        )}
      </Stack>
    </FormModal>
  );
}
