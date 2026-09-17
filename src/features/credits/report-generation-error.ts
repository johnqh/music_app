/**
 * How a failed generation is reported.
 *
 * Every other failure is a toast. Running out of credits is not: it is the one
 * refusal the user can do something about, so it opens the store instead of
 * telling them a request failed. Routing it here rather than at each call site
 * is what keeps the dashboard and the editor agreeing about it — they raise
 * jobs from different code and both were reporting the 402 as a network error.
 */
import { classifyGenerationError } from '@sudobility/music_client';
import { reportError, useAppStore } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { PAYWALL_DIALOG } from '@/features/credits/PaywallDialog';

export type ReportGenerationErrorOptions = {
  /** Prefix for the toast, when it is a toast. */
  context?: string;
  store?: EditorStoreApi;
};

/** True when the paywall was raised, so a caller can skip its own reporting. */
export function reportGenerationError(
  err: unknown,
  { context, store = useAppStore }: ReportGenerationErrorOptions = {},
): boolean {
  // Which refusals open the store is music_client's call, shared with the
  // native app — a bare 402 counts as well as the typed error.
  if (classifyGenerationError(err) === 'paywall') {
    store.getState().openDialog(PAYWALL_DIALOG);
    return true;
  }
  reportError(err, { context, store });
  return false;
}
