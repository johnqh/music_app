/**
 * Toast/snackbar queue (spec §6: "toast notifications"), rendered from
 * `ui-slice.toasts`. Shows one toast at a time (the oldest first); each
 * one auto-dismisses after a delay (errors linger longer, so a failure
 * message isn't missed) or can be dismissed immediately. A toast with an
 * `action` (spec §28: "retry actions where appropriate") shows a button
 * that runs it and then dismisses.
 *
 * The two buttons stay hand-rolled, and the reason is the ink. Each
 * severity is a pair of design tokens — a surface and the foreground the
 * theme declares for it (`bg-warning text-warning-foreground`) — and both
 * buttons inherit that foreground (Tailwind's preflight sets
 * `button { color: inherit }`). Every library `Button` variant states a
 * colour of its own, and no one variant is legible on all four surfaces.
 *
 * The pairs used to be palette classes with `text-white` on each. That
 * is wrong in the dark theme, where the tokens get lighter and their
 * declared foreground is black; and the fourth was `bg-theme-text-primary
 * text-theme-bg-primary`, two variables nothing defined, so an info toast
 * had no surface at all.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';

export type ToastsProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
};

const AUTO_HIDE_MS: Record<string, number> = {
  error: 8000,
  warning: 6000,
  success: 4000,
  info: 4000,
};

const SEVERITY_CLASSES: Record<string, string> = {
  error: 'bg-destructive text-destructive-foreground',
  warning: 'bg-warning text-warning-foreground',
  success: 'bg-success text-success-foreground',
  info: 'bg-foreground text-background',
};

export function Toasts({ store = useAppStore }: ToastsProps) {
  const { t } = useTranslation();
  const toasts = store((s) => s.toasts);
  const current = toasts[0] ?? null;

  const dismiss = (): void => {
    if (current) store.getState().dismissToast(current.id);
  };

  useEffect(() => {
    if (!current) return;
    const delay = AUTO_HIDE_MS[current.severity] ?? 4000;
    const timer = setTimeout(() => {
      store.getState().dismissToast(current.id);
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!current) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-sm">
      <div
        role={current.severity === 'error' || current.severity === 'warning' ? 'alert' : 'status'}
        className={`flex items-center gap-3 rounded-md px-4 py-3 shadow-lg ${SEVERITY_CLASSES[current.severity] ?? SEVERITY_CLASSES.info}`}
      >
        <span className="flex-1 text-sm">{current.message}</span>
        {current.action ? (
          <button
            type="button"
            className="shrink-0 rounded px-2 py-1 text-sm font-medium underline-offset-2 hover:underline"
            onClick={() => {
              current.action?.onClick();
              dismiss();
            }}
          >
            {current.action.label}
          </button>
        ) : undefined}
        <button
          type="button"
          aria-label={t('common.close')}
          className="shrink-0 rounded p-1 text-lg leading-none hover:opacity-80"
          onClick={dismiss}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
