/**
 * The instrument reference, generated from the catalogue.
 *
 * Read from `GM_CATALOGUE` rather than written out, because a table of 128
 * instruments transcribed into prose is a copy that goes stale on the first
 * correction — and this session corrected eleven of them. It also puts the
 * `basis` field in front of a reader, which is the thing worth knowing: a
 * compass somebody checked and a compass nobody checked look identical
 * everywhere else.
 *
 * The rows — the filter and every formatted cell — are music_types'
 * `gmInstrumentRows`, shared with the native app's reference; only the table
 * and the words for `unlimited` and each basis are this page's.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Text } from '@sudobility/components';
import { gmInstrumentRows } from '@sudobility/music_types';

const BASIS_TONE: Record<string, string> = {
  measured: 'text-success',
  tunable: 'text-warning',
  synthetic: 'text-muted-foreground',
  unpitched: 'text-muted-foreground',
  assumed: 'text-destructive',
};

export function InstrumentReference() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => gmInstrumentRows(query), [query]);

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('docs.instruments.search')}
        aria-label={t('docs.instruments.search')}
      />
      <Text as="p" size="xs" color="muted">
        {t('docs.instruments.showing', { count: rows.length })}
      </Text>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2 pr-3 font-medium">{t('docs.instruments.colProgram')}</th>
              <th className="py-2 pr-3 font-medium">{t('docs.instruments.colName')}</th>
              <th className="py-2 pr-3 font-medium">{t('docs.instruments.colFamily')}</th>
              <th className="py-2 pr-3 font-medium">{t('docs.instruments.colRange')}</th>
              <th className="py-2 pr-3 font-medium">{t('docs.instruments.colPolyphony')}</th>
              <th className="py-2 pr-3 font-medium">{t('docs.instruments.colTranspose')}</th>
              <th className="py-2 font-medium">{t('docs.instruments.colBasis')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.program} className="border-b border-border/40">
                <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{row.program}</td>
                <td className="py-1.5 pr-3">{row.name}</td>
                <td className="py-1.5 pr-3 text-muted-foreground">{row.familyLabel}</td>
                <td className="py-1.5 pr-3 tabular-nums">{row.range}</td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {row.polyphony ?? t('docs.instruments.polyUnlimited')}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">{row.transposition}</td>
                <td className={`py-1.5 ${BASIS_TONE[row.basis] ?? ''}`}>{t(row.basisKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
