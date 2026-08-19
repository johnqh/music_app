/**
 * Keyboard-shortcut help dialog (spec §6: "keyboard-shortcut help dialog"),
 * listing the exact shortcut table `useEditorShortcuts.ts` implements
 * (spec §7).
 *
 * The one dialog with nothing to confirm, so it passes `actions={[]}` and takes
 * `FormModal`'s own top-bar close as its only control.
 */
import { useTranslation } from 'react-i18next';
import { FormModal } from '@sudobility/components';

export type ShortcutHelpDialogProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * `keys` is printed verbatim in monospace and is deliberately **not**
 * translated: `Ctrl`, `Shift` and `ArrowUp` are the names the keyboard and the
 * browser use, and a reader hunting for a key does not want it renamed. The two
 * entries that describe a gesture rather than a key carry `keysKey` instead.
 */
const SHORTCUTS: Array<{ keys?: string; keysKey?: string; actionKey: string }> = [
  { keys: 'Space', actionKey: 'shortcuts.playPause' },
  { keys: 'Escape', actionKey: 'shortcuts.clearSelection' },
  { keys: 'Delete', actionKey: 'shortcuts.deleteNotes' },
  { keys: 'Ctrl/Cmd+Z', actionKey: 'editor.undo' },
  { keys: 'Ctrl/Cmd+Shift+Z', actionKey: 'editor.redo' },
  { keys: 'Ctrl/Cmd+C', actionKey: 'editor.copy' },
  { keys: 'Ctrl/Cmd+X', actionKey: 'editor.cut' },
  { keys: 'Ctrl/Cmd+V', actionKey: 'editor.paste' },
  { keys: 'ArrowUp / ArrowDown', actionKey: 'shortcuts.pitchSemitone' },
  { keys: 'Shift+ArrowUp / Shift+ArrowDown', actionKey: 'shortcuts.pitchOctave' },
  { keys: 'ArrowLeft / ArrowRight', actionKey: 'shortcuts.moveSelection' },
  { keysKey: 'shortcuts.clickChord', actionKey: 'shortcuts.selectEveryNote' },
  { keysKey: 'shortcuts.pianoKey', actionKey: 'shortcuts.addRemoveNote' },
];

export function ShortcutHelpDialog({ open, onClose }: ShortcutHelpDialogProps) {
  const { t } = useTranslation();
  return (
    <FormModal
      open={open}
      title={t('editor.keyboardShortcuts')}
      onClose={onClose}
      size="small"
      closeAriaLabel={t('common.close')}
      actions={[]}
    >
      <table aria-label={t('editor.keyboardShortcuts')} className="w-full border-collapse text-sm">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys ?? s.keysKey} className="border-b border-theme-border last:border-b-0">
              <th
                scope="row"
                className="whitespace-nowrap py-1.5 pr-4 text-left font-mono font-normal text-theme-text-primary"
              >
                {s.keys ?? t(s.keysKey!)}
              </th>
              <td className="py-1.5 text-theme-text-secondary">{t(s.actionKey)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </FormModal>
  );
}
