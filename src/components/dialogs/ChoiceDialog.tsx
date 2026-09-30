/**
 * A modal that asks one question with a small set of answers.
 *
 * Extracted at the third of these (export scope, cut, paste) rather than the
 * second: the shape had clearly stopped being a coincidence. Each caller still
 * writes its own question and its own option copy, because the wording is the
 * part that matters — this only owns the layout and the cancel behaviour.
 *
 * The house rule for every caller: **ask only when the answers differ.** A
 * prompt whose options do the same thing is a click the user cannot get wrong
 * and therefore should not be shown.
 */
import { useTranslation } from 'react-i18next';
import { Button, FormModal } from '@sudobility/components';

export type DialogChoice<T extends string> = {
  value: T;
  label: string;
  /** One line under the label, for when the label alone cannot carry it. */
  detail?: string;
  /** Exactly one option should be primary — the one most people want. */
  primary?: boolean;
};

export type ChoiceDialogProps<T extends string> = {
  open: boolean;
  title: string;
  /** The situation, in one sentence. Says what is true, not what to do. */
  message: string;
  choices: ReadonlyArray<DialogChoice<T>>;
  onChoose: (value: T) => void;
  onCancel: () => void;
};

export function ChoiceDialog<T extends string>({
  open,
  title,
  message,
  choices,
  onChoose,
  onCancel,
}: ChoiceDialogProps<T>) {
  const { t } = useTranslation();
  return (
    <FormModal
      open={open}
      title={title}
      onClose={onCancel}
      size="small"
      closeAriaLabel={t('common.closeDialog')}
      // The choices are the content, not the footer: each is a full-width
      // two-line button, which a footer row of peer actions cannot carry.
      actions={[{ label: t('common.cancel'), onClick: onCancel, variant: 'ghost' }]}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{message}</p>

        <div className="flex flex-col gap-2">
          {choices.map((choice) => (
            <Button
              key={choice.value}
              type="button"
              variant={choice.primary ? 'primary' : 'outline'}
              aria-label={choice.label}
              onClick={() => onChoose(choice.value)}
              className="w-full justify-start text-left"
            >
              <span className="flex flex-col items-start">
                <span>{choice.label}</span>
                {choice.detail ? <span className="text-xs opacity-80">{choice.detail}</span> : null}
              </span>
            </Button>
          ))}
        </div>
      </div>
    </FormModal>
  );
}
