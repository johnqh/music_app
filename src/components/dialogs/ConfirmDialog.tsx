/**
 * Generic yes/no confirmation dialog (spec §6: "confirmation dialogs"),
 * used before every destructive action the app shell offers: delete
 * project, delete track, reset device data, replace a project with a fresh
 * MIDI/MusicXML import. Re-skinned onto @sudobility/components' dialog
 * primitive (same props/labels as the MUI-era version).
 */
import { Dialog } from '@sudobility/components';
import { variants } from '@sudobility/design';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive color; default `true`, since every current caller confirms a destructive action. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog isOpen={open} onClose={onCancel} size="sm">
      <div role="dialog" aria-labelledby="confirm-dialog-title" className="p-6">
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-theme-text-primary">
          {title}
        </h2>
        <p className="mt-3 text-sm text-theme-text-secondary">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={variants.button.ghost.default()} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            className={destructive ? variants.button.destructive.default() : variants.button.primary.default()}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
