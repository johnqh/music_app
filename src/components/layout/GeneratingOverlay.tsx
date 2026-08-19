/**
 * Covers the editor while a generation job owns the project.
 *
 * A real cover, not just a dimmed look: the project is immutable server-side
 * for the duration, so any edit made underneath would be rejected with a 409
 * and lost. Leaving is ordinary navigation — nothing is held in the browser,
 * so the user can work on another project and come back.
 */
import { Button, Spinner } from '@sudobility/components';
import { useTranslation } from 'react-i18next';

export type GeneratingOverlayProps = {
  onCancel: () => void;
  /** Shown under the heading when a job reported one. */
  error?: string | null;
};

export function GeneratingOverlay({ onCancel, error }: GeneratingOverlayProps) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="generating-overlay"
      // inset-0 over a `relative` parent: the point is to intercept pointer
      // events, not merely to look busy.
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-theme-surface/80 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      {/* Decorative: `Spinner` carries its own role="status", and two nested
          live regions announce twice. The text below says it better. */}
      <div aria-hidden="true">
        <Spinner ariaLabel="Generating" size="large" />
      </div>
      <p className="text-sm font-medium text-theme-text-primary">{t('overlay.generatingNotes')}</p>
      <p className="max-w-xs text-center text-xs text-theme-text-secondary">
        This runs on the server. You can leave this project and work on another one — it will be
        here when it finishes.
      </p>
      {error && (
        <p role="alert" className="max-w-xs text-center text-xs text-red-700">
          {error}
        </p>
      )}
      <Button type="button" variant="outline" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}
