/**
 * Jump the caret to a bar by number.
 *
 * A long score has no other way to get somewhere specific: the caret is placed
 * by clicking, so reaching bar 180 means scrolling until you find it by eye.
 * Everything the editor aims — insertion, "play from here", a range selection
 * anchor — starts at the caret, so being unable to put it somewhere by name
 * makes all of them slower on exactly the scores where it matters most.
 *
 * Bars are numbered from 1, matching the numbers drawn in the gutter and the
 * status bar's readout — not the zero-based index the score stores.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormModal, Input } from '@sudobility/components';

export type GoToBarDialogProps = {
  open: boolean;
  /** How many bars there are, so the prompt can say the range. */
  barCount: number;
  onClose: () => void;
  /** Returns false when the bar does not exist, which keeps the dialog open. */
  onGo: (bar: number) => boolean;
};

export function GoToBarDialog({ open, barCount, onClose, onGo }: GoToBarDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (open) {
      setValue('');
      setError(false);
    }
  }, [open]);

  const submit = (): void => {
    const bar = Number(value);
    if (!Number.isFinite(bar) || !onGo(Math.round(bar))) {
      setError(true);
      return;
    }
    onClose();
  };

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={t('editor.goToBar')}
      onSave={submit}
      saveLabel={t('editor.go')}
      closeAriaLabel={t('common.closeDialog')}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-theme-text-secondary">
          {t('editor.barNumberOf', { count: barCount })}
        </span>
        <Input
          value={value}
          autoFocus
          inputMode="numeric"
          aria-label={t('editor.barNumber')}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setValue(e.target.value);
            setError(false);
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') submit();
          }}
        />
        {/* Says what is wrong and what would be right, rather than just refusing. */}
        {error ? (
          <span className="text-xs text-destructive">
            {t('editor.noSuchBar', { count: barCount })}
          </span>
        ) : null}
      </label>
    </FormModal>
  );
}
