/**
 * Keyboard-shortcut help dialog (spec §6: "keyboard-shortcut help dialog"),
 * listing the exact shortcut table `useEditorShortcuts.ts` implements
 * (spec §7).
 *
 * Adopts the library `Button` (library sweep 2) for the Close icon button.
 */
import { Button, Dialog } from '@sudobility/components';

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
    <Dialog isOpen={open} onClose={onClose} size="sm" showCloseButton={false}>
      <div role="dialog" aria-labelledby="shortcut-help-title" className="relative p-6">
        <h2 id="shortcut-help-title" className="text-lg font-semibold text-theme-text-primary">
          Keyboard shortcuts
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-4 top-4 h-auto w-auto p-1"
        >
          &times;
        </Button>
        <table aria-label="Keyboard shortcuts" className="mt-4 w-full border-collapse text-sm">
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
      </div>
    </Dialog>
  );
}
