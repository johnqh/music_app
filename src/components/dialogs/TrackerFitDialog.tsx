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
import type { TrackerFitReport } from '@sudobility/music_lib';

export type TrackerFitDialogProps = {
  open: boolean;
  format: string;
  report: TrackerFitReport;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The lines describing what this export will lose.
 *
 * Takes `t` rather than calling a hook, since it is a plain function; the
 * counts pluralise through i18next rather than by appending an "s", which is
 * an English-only rule.
 */
function fitReportLines(report: TrackerFitReport, format: string, t: TFunction): string[] {
  const out: string[] = [];
  if (report.clampedNotes > 0) {
    out.push(t('trackerFit.clampedNotes', { count: report.clampedNotes, format }));
  }
  if (report.droppedVoices > 0) {
    out.push(t('trackerFit.droppedVoices', { count: report.droppedVoices, format }));
  }
  if (report.droppedShortNotes > 0) {
    out.push(t('trackerFit.droppedShortNotes', { count: report.droppedShortNotes }));
  }
  if (report.quantisedNotes > 0) {
    out.push(t('trackerFit.quantisedNotes', { count: report.quantisedNotes }));
  }
  return out;
}

export function TrackerFitDialog({
  open,
  format,
  report,
  onConfirm,
  onCancel,
}: TrackerFitDialogProps) {
  const { t } = useTranslation();
  return (
    <FormModal
      open={open}
      title={t('trackerFit.title', { format })}
      onClose={onCancel}
      closeAriaLabel={t('common.closeDialog')}
      actions={[
        { label: t('common.cancel'), onClick: onCancel },
        { label: t('trackerFit.exportAnyway'), onClick: onConfirm },
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
