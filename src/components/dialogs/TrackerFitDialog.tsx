/**
 * What an export to this format will lose, and a chance to back out.
 *
 * Shown **only** when something was actually lost — a clean fit writes the file
 * with no click, which is the common case for XM and IT. The numbers are named
 * rather than summarised: "some notes were changed" is not something a user can
 * act on, where "12 notes outside ProTracker's range were moved" tells them to
 * try XM instead.
 */
import { FormModal } from '@sudobility/components';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { TrackerFitReport } from '@/app-library';
import { trackerFitLosses } from '@/app-library';

export type TrackerFitDialogProps = {
  open: boolean;
  format: string;
  report: TrackerFitReport;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while the module is being written: Export anyway spins, the dialog stays. */
  busy?: boolean;
};

/**
 * The lines describing what this export will lose.
 *
 * Which kinds of loss exist, and the order a reader meets them in, comes from
 * `trackerFitLosses` in music_codecs — a fact about the format rather than
 * about this dialog, and one the native app's sheet reads too. Takes `t` rather
 * than calling a hook, since it is a plain function; the counts pluralise
 * through i18next rather than by appending an "s", which is an English-only
 * rule.
 */
function fitReportLines(report: TrackerFitReport, format: string, t: TFunction): string[] {
  return trackerFitLosses(report).map(({ kind, count }) =>
    t(`trackerFit.${kind}`, { count, format }),
  );
}

export function TrackerFitDialog({
  open,
  format,
  report,
  onConfirm,
  onCancel,
  busy = false,
}: TrackerFitDialogProps) {
  const { t } = useTranslation();
  return (
    <FormModal
      open={open}
      title={t('trackerFit.title', { format })}
      onClose={onCancel}
      closeAriaLabel={t('common.closeDialog')}
      saving={busy}
      actions={[
        { label: t('common.cancel'), onClick: onCancel, disabled: busy },
        {
          label: t('trackerFit.exportAnyway'),
          onClick: () => {
            if (!busy) onConfirm();
          },
          loading: busy,
          loadingLabel: t('common.exporting'),
        },
      ]}
    >
      <div className="space-y-3 text-sm">
        <p>{t('trackerFit.doesNotFit', { format })}</p>
        <ul className="list-disc space-y-1 pl-5">
          {fitReportLines(report, format, t).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-muted-foreground">{t('trackerFit.notesOnly')}</p>
      </div>
    </FormModal>
  );
}
