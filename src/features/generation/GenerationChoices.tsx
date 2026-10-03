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
import { Button } from '@sudobility/components';
import type { GenerationRecord } from '@sudobility/music_types';
import {
  generationChoiceLabelKey,
  lockableChoiceRows,
  lockableChoiceValue,
  regenerateCreditEstimate,
  type LockableChoice,
} from '@/app-library';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { usePendingAction } from '@/hooks/usePendingAction';

export type GenerationChoicesProps = {
  record: GenerationRecord;
  /** True while a job owns the project: nothing can be started then. */
  generating: boolean;
  /**
   * The choices the reader locked, in the order they are shown. The request
   * itself is built by the caller through `regenerateWithLocks`, which is the
   * one place that knows a carrier locks by index and that an earlier run's
   * locks must not carry over — so this panel cannot send something the native
   * one would not.
   */
  onGenerateAgain: (lockedKeys: LockableChoice[]) => void | Promise<unknown>;
};

export function GenerationChoices({ record, generating, onGenerateAgain }: GenerationChoicesProps) {
  const { t } = useTranslation();
  const [locked, setLocked] = useState<ReadonlySet<LockableChoice>>(new Set());
  const [confirming, setConfirming] = useState(false);
  // The confirmation stays open, its button spinning, until the job is accepted.
  const [starting, runStart] = usePendingAction();
  const { choices } = record;

  // Which choices are lockable, in which order, and how each reads, are
  // music_lib's — shared with the native panel.
  const rows = lockableChoiceRows(record);
  const shown = (key: LockableChoice): string | null => lockableChoiceValue(choices, key);
  // The same request again, so the same bill: its bars times its tracks.
  const estimatedCredits = regenerateCreditEstimate(record);

  const toggle = (key: LockableChoice): void =>
    setLocked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section aria-labelledby="generation-choices-heading" className="flex flex-col gap-2">
      <p id="generation-choices-heading" className="text-sm font-semibold text-foreground">
        {t('generationChoices.heading')}
      </p>
      <p className="text-xs text-muted-foreground">{t('generationChoices.hint')}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((key) => (
          <li key={key} className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={locked.has(key)}
              disabled={generating}
              aria-label={t('generationChoices.lock', { name: t(generationChoiceLabelKey(key)) })}
              onChange={() => toggle(key)}
            />
            <span className="min-w-0 flex-1 text-xs">
              <span className="text-muted-foreground">{t(generationChoiceLabelKey(key))}: </span>
              <span className="text-foreground" title={shown(key) ?? undefined}>
                {shown(key)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        disabled={generating}
        onClick={() => setConfirming(true)}
        className="self-start px-3 py-1 text-xs"
      >
        {locked.size > 0
          ? t('generationChoices.againKeeping', { count: locked.size })
          : t('generationChoices.again')}
      </Button>
      {estimatedCredits > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('generate.estimate', { count: estimatedCredits })}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title={t('generationChoices.confirmTitle')}
        message={t('generationChoices.confirmMessage')}
        confirmLabel={t('generationChoices.confirm')}
        onConfirm={() =>
          void runStart(async () => {
            await onGenerateAgain(rows.filter((key) => locked.has(key)));
            setConfirming(false);
          })
        }
        busy={starting}
        busyLabel={t('common.starting')}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
