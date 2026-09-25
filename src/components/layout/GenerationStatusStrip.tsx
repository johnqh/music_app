/**
 * The row that says a generation job owns this project, while the notes it
 * writes appear in the score above.
 *
 * A strip rather than a cover: the score is the point. The job streams each
 * part as it is written, and a reader who opened the project to watch that
 * must be able to see it — scroll it, zoom it, mute a part. What must not
 * happen underneath is an edit or a play, and neither can: the store's edit
 * lock refuses content commands, the score view is read-only, and the
 * transport's Play is disabled for the duration. The strip is what tells the
 * reader why.
 *
 * Leaving is ordinary navigation — nothing is held in the browser, so the
 * user can work on another project and come back; the project reloads to
 * wherever the job has got to.
 */
import { Button, Spinner } from '@sudobility/components';
import { useTranslation } from 'react-i18next';
import type { LiveGenerationProgress } from '@sudobility/music_types';
import type { LiveStatus } from '@sudobility/music_client';

export type GenerationStatusStripProps = {
  onCancel: () => void;
  /** The stream's last progress note, when there is one. */
  progress?: LiveGenerationProgress | null;
  /** Where the live stream stands: only its troubles are worth a word. */
  live?: LiveStatus;
  /** Shown beside the heading when a job reported one. */
  error?: string | null;
};

export function GenerationStatusStrip({
  onCancel,
  progress = null,
  live = 'off',
  error,
}: GenerationStatusStripProps) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="generation-status-strip"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-theme-border bg-theme-surface px-4 py-2"
      role="status"
      aria-live="polite"
    >
      {/* Decorative: `Spinner` carries its own role="status", and two nested
          live regions announce twice. The text says it better. */}
      <div aria-hidden="true">
        <Spinner ariaLabel="Generating" size="small" />
      </div>
      <span className="text-sm font-medium text-theme-text-primary">
        {t('overlay.generatingNotes')}
      </span>
      {progress ? (
        <span className="text-xs text-theme-text-secondary">
          {t('overlay.progress', {
            stage: t(`overlay.stage.${progress.stage}`),
            done: progress.done,
            total: progress.total,
            label: progress.label,
          })}
        </span>
      ) : null}
      {live === 'reconnecting' ? (
        <span className="text-xs text-theme-text-secondary">{t('overlay.reconnecting')}</span>
      ) : live === 'fallback' ? (
        <span className="text-xs text-theme-text-secondary">{t('overlay.polling')}</span>
      ) : null}
      <span className="hidden text-xs text-theme-text-secondary md:inline">
        {t('overlay.lockedWhileGenerating')}
      </span>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="flex-1" />
      <Button type="button" variant="outline" onClick={onCancel} className="px-3 py-1 text-xs">
        {t('common.cancel')}
      </Button>
    </div>
  );
}
