/**
 * Generic yes/no confirmation dialog (spec §6: "confirmation dialogs"),
 * used before every destructive action the app shell offers: delete
 * project, delete track, reset device data, replace a project with a fresh
 * MIDI/MusicXML import. Re-skinned onto @sudobility/components' dialog
 * primitive (same props/labels as the MUI-era version).
 *
 * On `FormModal` like every other dialog here, through its `actions` footer:
 * the single-CTA form cannot render a destructive confirm, and a red button is
 * the whole point of a delete prompt.
 */
import { FormModal } from '@sudobility/components';

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
    <FormModal
      open={open}
      title={title}
      onClose={onCancel}
      size="small"
      // Not `cancelLabel`: the footer already has a button by that name, and
      // two controls sharing an accessible name is ambiguous to a screen
      // reader and an outright strict-mode failure in tests.
      closeAriaLabel="Close dialog"
      actions={[
        { label: cancelLabel, onClick: onCancel, variant: 'ghost' },
        {
          label: confirmLabel,
          onClick: onConfirm,
          variant: destructive ? 'destructive' : 'primary',
          autoFocus: true,
        },
      ]}
    >
      <p className="text-sm text-theme-text-secondary">{message}</p>
    </FormModal>
  );
}
