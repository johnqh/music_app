import { useEffect, useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { FormModal, Input, Switch } from '@sudobility/components';
import type { InsertBarsPosition } from '@sudobility/music_editing';

export type InsertBarsDialogResult = {
  count: number;
  position: InsertBarsPosition;
  generate: boolean;
};

export type InsertBarsDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (result: InsertBarsDialogResult) => void;
};

export function InsertBarsDialog({ open, onClose, onSubmit }: InsertBarsDialogProps) {
  const { t } = useTranslation();
  const [count, setCount] = useState('4');
  const [position, setPosition] = useState<InsertBarsPosition>('after');
  const [generate, setGenerate] = useState(false);

  useEffect(() => {
    if (open) {
      setCount('4');
      setPosition('after');
      setGenerate(false);
    }
  }, [open]);

  const submit = (): void => {
    const parsed = Number(count);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 999) return;
    onSubmit({ count: parsed, position, generate });
  };

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={t('editor.insertBarsTitle')}
      onSave={submit}
      saveLabel={t('editor.insertBars')}
      closeAriaLabel={t('common.closeDialog')}
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-theme-text-secondary">{t('editor.barCount')}</span>
          <Input
            value={count}
            autoFocus
            inputMode="numeric"
            aria-label={t('editor.barCount')}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCount(event.target.value)}
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs text-theme-text-secondary">
            {t('editor.insertBarsPosition')}
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="insert-bars-position"
              checked={position === 'before'}
              onChange={() => setPosition('before')}
            />
            {t('editor.insertBarsBefore')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="insert-bars-position"
              checked={position === 'after'}
              onChange={() => setPosition('after')}
            />
            {t('editor.insertBarsAfter')}
          </label>
        </fieldset>

        <label className="flex items-center gap-3">
          <Switch
            checked={generate}
            onCheckedChange={setGenerate}
            aria-label={t('editor.generateInsertedBars')}
          />
          <span className="flex flex-col">
            <span className="text-sm text-theme-text-primary">
              {t('editor.generateInsertedBars')}
            </span>
            <span className="text-xs text-theme-text-secondary">
              {t('editor.generateInsertedBarsHint')}
            </span>
          </span>
        </label>
      </div>
    </FormModal>
  );
}
