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
import { useTranslation } from 'react-i18next';

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
  /**
   * True while the confirmed work is running. The confirm button shows
   * `busyLabel` and refuses a second press, and the dialog cannot be dismissed
   * meanwhile: it stays open until the caller closes it.
   */
  busy?: boolean;
  busyLabel?: string;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = true,
  onConfirm,
  onCancel,
  busy = false,
  busyLabel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  // Resolved here rather than as parameter defaults: a default is evaluated
  // once at module scope, which would freeze the label in whatever language
  // was active when the module first loaded.
  const confirm = confirmLabel ?? t('common.confirm');
  const cancel = cancelLabel ?? t('common.cancel');
  return (
    <FormModal
      open={open}
      title={title}
      onClose={onCancel}
      size="small"
      // Blocks Escape, the overlay and the × while the work runs.
      saving={busy}
      // Not `cancelLabel`: the footer already has a button by that name, and
      // two controls sharing an accessible name is ambiguous to a screen
      // reader and an outright strict-mode failure in tests.
      closeAriaLabel={t('common.closeDialog')}
      actions={[
        { label: cancel, onClick: onCancel, variant: 'ghost', disabled: busy },
        {
          label: confirm,
          onClick: () => {
            if (!busy) onConfirm();
          },
          loading: busy,
          loadingLabel: busyLabel ?? t('common.working'),
          variant: destructive ? 'destructive' : 'primary',
          autoFocus: true,
        },
      ]}
    >
      <p className="text-sm text-muted-foreground">{message}</p>
    </FormModal>
  );
}
