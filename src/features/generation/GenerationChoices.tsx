/**
 * The choices the last generation was built from, with a lock beside each.
 *
 * The server rolls a groove, a chord cycle, a hook, an arrangement, a signature
 * moment, a tune carrier and a lyric approach for every piece, so two
 * generations of one request are two pieces. That variety was invisible and
 * uncontrollable: a user who liked the groove could not keep it and hear other
 * chords. Here each choice is shown by name; locking one and generating again
 * sends the same request with the locked choices kept and the rest re-rolled.
 *
 * Generating again replaces the whole score, so it asks first.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GenerationChoices as Choices, GenerationRecord } from '@sudobility/music_types';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

/** The choices a user can lock, in the order they are shown. */
const LOCKABLE = [
  'groove',
  'cycle',
  'arcEntry',
  'arcIntensity',
  'moment',
  'carrier',
  'formShape',
  'hook',
  'lyric',
] as const;
type Lockable = (typeof LOCKABLE)[number];

export type GenerationChoicesProps = {
  record: GenerationRecord;
  /** True while a job owns the project: nothing can be started then. */
  generating: boolean;
  onGenerateAgain: (locks: Partial<Choices>) => void;
};

export function GenerationChoices({ record, generating, onGenerateAgain }: GenerationChoicesProps) {
  const { t } = useTranslation();
  const [locked, setLocked] = useState<ReadonlySet<Lockable>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const { choices } = record;

  const shown = (key: Lockable): string | null => {
    if (key === 'carrier') return choices.carrierName;
    const value = choices[key];
    return typeof value === 'string' ? value : null;
  };
  const rows = LOCKABLE.filter((key) => shown(key) !== null);

  const toggle = (key: Lockable): void =>
    setLocked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const locks = (): Partial<Choices> => {
    const out: Partial<Choices> = {};
    for (const key of locked) {
      if (key === 'carrier') out.carrier = choices.carrier;
      else (out as Record<string, unknown>)[key] = choices[key];
    }
    return out;
  };

  return (
    <section aria-labelledby="generation-choices-heading" className="flex flex-col gap-2">
      <p id="generation-choices-heading" className="text-sm font-semibold text-theme-text-primary">
        {t('generationChoices.heading')}
      </p>
      <p className="text-xs text-theme-text-secondary">{t('generationChoices.hint')}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((key) => (
          <li key={key} className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={locked.has(key)}
              disabled={generating}
              aria-label={t('generationChoices.lock', { name: t(`generationChoices.${key}`) })}
              onChange={() => toggle(key)}
            />
            <span className="min-w-0 flex-1 text-xs">
              <span className="text-theme-text-secondary">{t(`generationChoices.${key}`)}: </span>
              <span className="text-theme-text-primary" title={shown(key) ?? undefined}>
                {shown(key)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={generating}
        onClick={() => setConfirming(true)}
        className="self-start rounded border border-theme-border px-2 py-1 text-xs text-theme-text-primary disabled:opacity-50"
      >
        {locked.size > 0
          ? t('generationChoices.againKeeping', { count: locked.size })
          : t('generationChoices.again')}
      </button>
      <ConfirmDialog
        open={confirming}
        title={t('generationChoices.confirmTitle')}
        message={t('generationChoices.confirmMessage')}
        confirmLabel={t('generationChoices.confirm')}
        onConfirm={() => {
          setConfirming(false);
          onGenerateAgain(locks());
        }}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
