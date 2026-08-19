/**
 * Asks whether an export should carry the hidden tracks.
 *
 * Only shown when some are hidden. A file that quietly omits parts is hard to
 * notice until it matters, and silently exporting everything would equally
 * surprise someone who hid tracks precisely to extract a subset — so the
 * question is asked exactly when the two answers differ, and never otherwise.
 */
import { FormModal } from '@sudobility/components';
import { useTranslation } from 'react-i18next';

export type ExportScope = 'all' | 'visible';

export type ExportScopeDialogProps = {
  open: boolean;
  /** How many tracks would be left out. Never 0 while `open` — see the module doc. */
  hiddenCount: number;
  onChoose: (scope: ExportScope) => void;
  onCancel: () => void;
};

export function ExportScopeDialog({
  open,
  hiddenCount,
  onChoose,
  onCancel,
}: ExportScopeDialogProps) {
  const { t } = useTranslation();
  return (
    <FormModal
      open={open}
      title={t('exportScope.title')}
      onClose={onCancel}
      size="small"
      closeAriaLabel={t('common.closeDialog')}
      actions={[
        { label: t('common.cancel'), onClick: onCancel, variant: 'ghost' },
        {
          label: t('exportScope.visibleOnly'),
          onClick: () => onChoose('visible'),
          variant: 'outline',
        },
        { label: t('print.wholeScore'), onClick: () => onChoose('all'), variant: 'primary' },
      ]}
    >
      <p className="text-sm text-theme-text-secondary">
        {t('exportScope.hiddenCount', { count: hiddenCount })}
      </p>
    </FormModal>
  );
}
