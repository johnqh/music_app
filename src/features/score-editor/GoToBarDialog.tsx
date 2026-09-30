/**
 * Jump the caret to a bar by number.
 *
 * A long score has no other way to get somewhere specific: the caret is placed
 * by clicking, so reaching bar 180 means scrolling until you find it by eye.
 * Everything the editor aims — insertion, "play from here", a range selection
 * anchor — starts at the caret, so being unable to put it somewhere by name
 * makes all of them slower on exactly the scores where it matters most.
 *
 * Bars are numbered as the gutter draws them — not the zero-based index the
 * score stores, and not `index + 1` either, since a pickup has no number. The
 * dialog hands over the text as typed and `goToBarFromInput` (music_editing,
 * shared with the native prompt) decides what it names.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormModal, Input } from '@sudobility/components';

export type GoToBarDialogProps = {
  open: boolean;
  /** How many bars there are, so the prompt can say the range. */
  barCount: number;
  onClose: () => void;
  /** Given the text as typed. Returns false when it names no bar, which keeps the dialog open. */
  onGo: (text: string) => boolean;
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
    if (!onGo(value)) {
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
        <span className="text-xs text-muted-foreground">
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
