/**
 * Keyboard-shortcut help dialog (spec §6: "keyboard-shortcut help dialog"),
 * listing the exact shortcut table `useEditorShortcuts.ts` implements
 * (spec §7).
 *
 * The one dialog with nothing to confirm, so it passes `actions={[]}` and takes
 * `FormModal`'s own top-bar close as its only control.
 */
import { FormModal } from '@sudobility/components';

export type ShortcutHelpDialogProps = {
  open: boolean;
  onClose: () => void;
};

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Space', action: 'Play / pause' },
  { keys: 'Escape', action: 'Clear selection' },
  { keys: 'Delete', action: 'Delete selected notes' },
  { keys: 'Ctrl/Cmd+Z', action: 'Undo' },
  { keys: 'Ctrl/Cmd+Shift+Z', action: 'Redo' },
  { keys: 'Ctrl/Cmd+C', action: 'Copy' },
  { keys: 'Ctrl/Cmd+X', action: 'Cut' },
  { keys: 'Ctrl/Cmd+V', action: 'Paste' },
  { keys: 'ArrowUp / ArrowDown', action: 'Move pitch up/down a semitone' },
  { keys: 'Shift+ArrowUp / Shift+ArrowDown', action: 'Move pitch up/down an octave' },
  { keys: 'ArrowLeft / ArrowRight', action: 'Move selection backward/forward' },
  { keys: 'Click a chord', action: 'Select every note in it' },
  { keys: 'Piano key (chord selected)', action: 'Add or remove that note' },
];

export function ShortcutHelpDialog({ open, onClose }: ShortcutHelpDialogProps) {
  return (
    <FormModal
      open={open}
      title="Keyboard shortcuts"
      onClose={onClose}
      size="small"
      closeAriaLabel="Close"
      actions={[]}
    >
      <table aria-label="Keyboard shortcuts" className="w-full border-collapse text-sm">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys} className="border-b border-theme-border last:border-b-0">
              <th
                scope="row"
                className="whitespace-nowrap py-1.5 pr-4 text-left font-mono font-normal text-theme-text-primary"
              >
                {s.keys}
              </th>
              <td className="py-1.5 text-theme-text-secondary">{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </FormModal>
  );
}
