/**
 * The instrument reference, generated from the catalogue.
 *
 * Read from `GM_CATALOGUE` rather than written out, because a table of 128
 * instruments transcribed into prose is a copy that goes stale on the first
 * correction — and this session corrected eleven of them. It also puts the
 * `basis` field in front of a reader, which is the thing worth knowing: a
 * compass somebody checked and a compass nobody checked look identical
 * everywhere else.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Text } from '@sudobility/components';
import {
  GM_CATALOGUE,
  GM_FAMILY_LABELS,
  midiToPitch,
  UNLIMITED_POLYPHONY,
} from '@sudobility/music_lib';

function noteName(midi: number): string {
  const pitch = midiToPitch(midi);
  const accidental = pitch.accidental === 1 ? '♯' : pitch.accidental === -1 ? '♭' : '';
  return `${pitch.step}${accidental}${pitch.octave}`;
}

const BASIS_TONE: Record<string, string> = {
  measured: 'text-theme-success',
  tunable: 'text-theme-warning',
  synthetic: 'text-theme-text-secondary',
  unpitched: 'text-theme-text-secondary',
  assumed: 'text-theme-error',
};

export function InstrumentReference() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return GM_CATALOGUE.filter(
      (spec) =>
        needle.length === 0 ||
        spec.name.toLowerCase().includes(needle) ||
        String(spec.program) === needle ||
        spec.family.includes(needle),
    );
  }, [query]);

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
            <tr className="border-b border-theme-border text-left">
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
            {rows.map((spec) => (
              <tr key={spec.program} className="border-b border-theme-border/40">
                <td className="py-1.5 pr-3 tabular-nums text-theme-text-secondary">
                  {spec.program}
                </td>
                <td className="py-1.5 pr-3">{spec.name}</td>
                <td className="py-1.5 pr-3 text-theme-text-secondary">
                  {GM_FAMILY_LABELS[spec.family]}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {noteName(spec.range.min)}–{noteName(spec.range.max)}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {spec.maxPolyphony === UNLIMITED_POLYPHONY
                    ? t('docs.instruments.polyUnlimited')
                    : spec.maxPolyphony}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {spec.writtenTransposition === 0
                    ? '—'
                    : `${spec.writtenTransposition > 0 ? '+' : ''}${spec.writtenTransposition}`}
                </td>
                <td className={`py-1.5 ${BASIS_TONE[spec.basis] ?? ''}`}>
                  {t(`docs.instruments.basis.${spec.basis}`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
