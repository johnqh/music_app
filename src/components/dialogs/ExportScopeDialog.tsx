/**
 * Asks whether an export should carry the hidden tracks.
 *
 * Only shown when some are hidden. A file that quietly omits parts is hard to
 * notice until it matters, and silently exporting everything would equally
 * surprise someone who hid tracks precisely to extract a subset — so the
 * question is asked exactly when the two answers differ, and never otherwise.
 */
import { FormModal } from '@sudobility/components';

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
  return (
    <FormModal
      open={open}
      title="Export hidden tracks?"
      onClose={onCancel}
      size="small"
      closeAriaLabel="Close dialog"
      actions={[
        { label: 'Cancel', onClick: onCancel, variant: 'ghost' },
        { label: 'Visible tracks only', onClick: () => onChoose('visible'), variant: 'outline' },
        { label: 'Whole score', onClick: () => onChoose('all'), variant: 'primary' },
      ]}
    >
      <p className="text-sm text-theme-text-secondary">
        This score has {hiddenCount} hidden {hiddenCount === 1 ? 'track' : 'tracks'}.
      </p>
    </FormModal>
  );
}
