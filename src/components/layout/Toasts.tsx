/**
 * Toast/snackbar queue (spec §6: "toast notifications"), rendered from
 * `ui-slice.toasts`. Shows one toast at a time (the oldest first); each
 * one auto-dismisses after a delay (errors linger longer, so a failure
 * message isn't missed) or can be dismissed immediately. A toast with an
 * `action` (spec §28: "retry actions where appropriate") shows a button
 * that runs it and then dismisses.
 */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
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

export function Toasts({ store = useAppStore }: ToastsProps) {
  const toasts = store((s) => s.toasts);
  const current = toasts[0] ?? null;

  const dismiss = (): void => {
    if (current) store.getState().dismissToast(current.id);
  };

  return (
    <Snackbar
      open={current !== null}
      autoHideDuration={current ? (AUTO_HIDE_MS[current.severity] ?? 4000) : null}
      onClose={(_event, reason) => {
        if (reason === 'clickaway') return;
        dismiss();
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      {current ? (
        <Alert
          severity={current.severity}
          variant="filled"
          onClose={dismiss}
          action={
            current.action ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  current.action?.onClick();
                  dismiss();
                }}
              >
                {current.action.label}
              </Button>
            ) : undefined
          }
        >
          {current.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );
}
