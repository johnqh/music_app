/**
 * Keyboard-shortcut help dialog (spec §6: "keyboard-shortcut help dialog"),
 * listing the exact shortcut table `useEditorShortcuts.ts` implements
 * (spec §7).
 *
 * The one dialog with nothing to confirm, so it passes `actions={[]}` and takes
 * `FormModal`'s own top-bar close as its only control.
 */
import { useTranslation } from 'react-i18next';
import { SHORTCUTS } from '@/features/score-editor/shortcut-table';
import { FormModal } from '@sudobility/components';
import { useCurrentLanguage } from '@/hooks/useLocalizedNavigate';

export type ShortcutHelpDialogProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * `keys` is printed verbatim in monospace and is deliberately **not**
 * translated: `Ctrl`, `Shift` and `ArrowUp` are the names the keyboard and the
 * browser use, and a reader hunting for a key does not want it renamed. The two
 * entries that describe a gesture rather than a key carry `keysKey` instead.
 *
 * A ` / ` separates alternatives, and the table stacks them one per line rather
 * than printing them across: `Ctrl/Cmd+Home / Ctrl/Cmd+End` on one line sets the
 * key column's width for all twenty-four rows, which squeezed every description
 * beside it into two and three lines.
 *
 * The rows themselves live in `features/score-editor/shortcut-table.ts`, because
 * the documentation page shows them too and a second copy is how this one fell
 * six shortcuts behind the bindings.
 */

export function ShortcutHelpDialog({ open, onClose }: ShortcutHelpDialogProps) {
  const { t } = useTranslation();
  const lang = useCurrentLanguage();
  return (
    <FormModal
      open={open}
      title={t('editor.keyboardShortcuts')}
      onClose={onClose}
      size="large"
      closeAriaLabel={t('common.close')}
      actions={[]}
    >
      <table aria-label={t('editor.keyboardShortcuts')} className="w-full border-collapse text-sm">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys ?? s.keysKey} className="border-b border-theme-border last:border-b-0">
              <th
                scope="row"
                // `w-px` with `whitespace-nowrap`: the column takes exactly the
                // width of its widest *line* and the description gets the rest.
                className="w-px whitespace-nowrap py-1.5 pr-6 text-left align-top font-mono font-normal text-foreground"
              >
                {(s.keys ?? t(s.keysKey!)).split(' / ').map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </th>
              <td className="py-1.5 align-top text-theme-text-secondary">{t(s.actionKey)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/*
        The dialog is the quick answer; the documentation is the long one. A
        new tab rather than navigation, because reading about the editor
        should not mean leaving the score open in it.
      */}
      <a
        href={`/${lang}/docs/shortcuts`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-block text-sm text-theme-primary underline"
      >
        {t('editor.shortcutsInDocs')}
      </a>
    </FormModal>
  );
}
