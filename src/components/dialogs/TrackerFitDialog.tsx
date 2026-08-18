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
import type { TrackerFitReport } from '@sudobility/music_lib';

export type TrackerFitDialogProps = {
  open: boolean;
  format: string;
  report: TrackerFitReport;
  onConfirm: () => void;
  onCancel: () => void;
};

export function fitReportLines(report: TrackerFitReport, format: string): string[] {
  const out: string[] = [];
  const plural = (n: number) => (n === 1 ? '' : 's');
  if (report.clampedNotes > 0) {
    out.push(
      `${report.clampedNotes} note${plural(report.clampedNotes)} outside ${format}'s range were moved by whole octaves.`,
    );
  }
  if (report.droppedVoices > 0) {
    out.push(
      `${report.droppedVoices} voice${plural(report.droppedVoices)} did not fit ${format}'s channel count and will be missing.`,
    );
  }
  if (report.droppedShortNotes > 0) {
    out.push(
      `${report.droppedShortNotes} note${plural(report.droppedShortNotes)} shorter than one row were dropped.`,
    );
  }
  if (report.quantisedNotes > 0) {
    out.push(
      `${report.quantisedNotes} note${plural(report.quantisedNotes)} moved slightly to land on the row grid.`,
    );
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
  return (
    <FormModal
      open={open}
      title={`Export as ${format}`}
      onClose={onCancel}
      closeAriaLabel="Close dialog"
      actions={[
        { label: 'Cancel', onClick: onCancel },
        { label: 'Export anyway', onClick: onConfirm },
      ]}
    >
      <div className="space-y-3 text-sm">
        <p>This score does not fit {format} exactly:</p>
        <ul className="list-disc space-y-1 pl-5">
          {fitReportLines(report, format).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          The file carries notes only — its instrument slots are named but empty, so it will be
          silent until you add samples in a tracker.
        </p>
      </div>
    </FormModal>
  );
}
