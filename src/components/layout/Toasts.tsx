/**
 * Toast/snackbar queue (spec §6: "toast notifications"), rendered from
 * `ui-slice.toasts`. Shows one toast at a time (the oldest first); each
 * one auto-dismisses after a delay (errors linger longer, so a failure
 * message isn't missed) or can be dismissed immediately. A toast with an
 * `action` (spec §28: "retry actions where appropriate") shows a button
 * that runs it and then dismisses.
 */
import { useEffect } from 'react';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';

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
  error: 'bg-red-600 text-white',
  warning: 'bg-amber-500 text-white',
  success: 'bg-green-600 text-white',
  info: 'bg-theme-text-primary text-theme-bg-primary',
};

export function Toasts({ store = useAppStore }: ToastsProps) {
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
          aria-label="Close"
          className="shrink-0 rounded p-1 text-lg leading-none hover:opacity-80"
          onClick={dismiss}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
