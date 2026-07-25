/**
 * Keyboard-shortcut help dialog (spec §6: "keyboard-shortcut help dialog"),
 * listing the exact shortcut table `useEditorShortcuts.ts` implements
 * (spec §7).
 */
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';

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
];

export function ShortcutHelpDialog({ open, onClose }: ShortcutHelpDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="shortcut-help-title" maxWidth="sm" fullWidth>
      <DialogTitle id="shortcut-help-title">
        Keyboard shortcuts
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          ✕
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Table size="small" aria-label="Keyboard shortcuts">
          <TableBody>
            {SHORTCUTS.map((s) => (
              <TableRow key={s.keys}>
                <TableCell component="th" scope="row" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {s.keys}
                </TableCell>
                <TableCell>{s.action}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
