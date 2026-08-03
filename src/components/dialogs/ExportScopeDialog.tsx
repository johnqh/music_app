/**
 * Asks whether an export should carry the hidden tracks.
 *
 * Only shown when some are hidden. A file that quietly omits parts is hard to
 * notice until it matters, and silently exporting everything would equally
 * surprise someone who hid tracks precisely to extract a subset — so the
 * question is asked exactly when the two answers differ, and never otherwise.
 */
import { Button, Dialog } from '@sudobility/components';

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
    <Dialog isOpen={open} onClose={onCancel} size="sm" showCloseButton={false}>
      <div role="dialog" aria-labelledby="export-scope-title" className="p-6">
        <h2 id="export-scope-title" className="text-lg font-semibold text-theme-text-primary">
          Export hidden tracks?
        </h2>
        <p className="mt-2 text-sm text-theme-text-secondary">
          This score has {hiddenCount} hidden {hiddenCount === 1 ? 'track' : 'tracks'}.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => onChoose('visible')}>
            Visible tracks only
          </Button>
          <Button type="button" variant="primary" onClick={() => onChoose('all')}>
            Whole score
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
