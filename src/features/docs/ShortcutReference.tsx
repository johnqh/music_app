/**
 * The shortcut table, from the same list the help dialog shows.
 *
 * Grouped, because twenty-nine rows in one run is a list nobody reads to the
 * end of. The rows come from `shortcut-table.ts` — see that file for why they
 * are not written out here.
 */
import { useTranslation } from 'react-i18next';
import { Heading } from '@sudobility/components';
import { SHORTCUTS, shortcutGroupLabelKey } from '@sudobility/music_editing';
import { SHORTCUT_GROUPS, type ShortcutGroup } from '@sudobility/music_types';

export function ShortcutReference() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      {SHORTCUT_GROUPS.map((group: ShortcutGroup) => {
        const rows = SHORTCUTS.filter((row) => row.group === group);
        if (rows.length === 0) return null;
        return (
          <div key={group}>
            <Heading level={4} className="mb-2 text-base">
              {t(shortcutGroupLabelKey(group))}
            </Heading>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((row) => (
                  <tr key={row.actionKey} className="border-b border-border/40 align-top">
                    <th scope="row" className="w-56 py-1.5 pr-4 text-left font-medium">
                      <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {row.keys ?? t(row.keysKey!)}
                      </kbd>
                    </th>
                    <td className="py-1.5 text-muted-foreground">{t(row.actionKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
