/**
 * What the app reads and writes, from the one declaration of it.
 *
 * See `formats.ts`: a paragraph naming the formats would be a copy of that
 * list, and would stop being true the first time one was added.
 */
import { useTranslation } from 'react-i18next';
import { Heading, Text } from '@sudobility/components';
import { EXPORT_FORMATS, IMPORT_FORMATS, type FormatEntry } from './formats';

function FormatTable({ titleKey, entries }: { titleKey: string; entries: readonly FormatEntry[] }) {
  const { t } = useTranslation();
  return (
    <div>
      <Heading level={4} className="mb-2 text-base">
        {t(titleKey)}
      </Heading>
      <table className="w-full text-sm">
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-border/40 align-top">
              <th scope="row" className="w-44 py-1.5 pr-4 text-left font-medium">
                {t(`docs.formats.name.${entry.id}`)}
                <Text as="p" size="xs" color="muted" className="font-mono">
                  {entry.extensions}
                </Text>
              </th>
              <td className="py-1.5 text-muted-foreground">{t(entry.noteKey)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FormatReference() {
  return (
    <div className="flex flex-col gap-6">
      <FormatTable titleKey="docs.formats.importsHeading" entries={IMPORT_FORMATS} />
      <FormatTable titleKey="docs.formats.exportsHeading" entries={EXPORT_FORMATS} />
    </div>
  );
}
