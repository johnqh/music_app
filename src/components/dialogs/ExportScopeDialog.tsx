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
  /**
   * The scope being exported, while the file is written: that button spins,
   * the other refuses a press, and the dialog stays open until it is done.
   */
  busy?: ExportScope | null;
};

export function ExportScopeDialog({
  open,
  hiddenCount,
  onChoose,
  onCancel,
  busy = null,
}: ExportScopeDialogProps) {
  const { t } = useTranslation();
  const working = busy !== null;
  const choose = (scope: ExportScope): void => {
    if (!working) onChoose(scope);
  };
  return (
    <FormModal
      open={open}
      title={t('exportScope.title')}
      onClose={onCancel}
      size="small"
      closeAriaLabel={t('common.closeDialog')}
      saving={working}
      actions={[
        { label: t('common.cancel'), onClick: onCancel, variant: 'ghost', disabled: working },
        {
          label: t('exportScope.visibleOnly'),
          onClick: () => choose('visible'),
          variant: 'outline',
          disabled: working,
          loading: busy === 'visible',
          loadingLabel: t('common.exporting'),
        },
        {
          label: t('print.wholeScore'),
          onClick: () => choose('all'),
          variant: 'primary',
          disabled: working,
          loading: busy === 'all',
          loadingLabel: t('common.exporting'),
        },
      ]}
    >
      <p className="text-sm text-muted-foreground">
        {t('exportScope.hiddenCount', { count: hiddenCount })}
      </p>
    </FormModal>
  );
}
