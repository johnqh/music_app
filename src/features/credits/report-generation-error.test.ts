import { describe, expect, it } from 'vitest';
import { createAppStore, testStoreContext } from '@sudobility/music_lib';
import { ApiError, InsufficientCreditsError } from '@sudobility/music_client';
import { reportGenerationError } from '@/features/credits/report-generation-error';
import { PAYWALL_DIALOG } from '@/features/credits/PaywallDialog';
import type { EditorStoreApi } from '@sudobility/music_lib';

function makeStore(): EditorStoreApi {
  return createAppStore({ context: testStoreContext() }) as unknown as EditorStoreApi;
}

describe('reportGenerationError', () => {
  it('opens the store when the job was refused for want of credits', () => {
    // `POST /jobs` answers 402 at a balance of zero. That is the one refusal
    // with a remedy, so it must not read like a network failure.
    const store = makeStore();
    const raised = reportGenerationError(new InsufficientCreditsError(), { store });

    expect(raised).toBe(true);
    expect(store.getState().dialogs[PAYWALL_DIALOG]).toBe(true);
    expect(store.getState().toasts).toEqual([]);
  });

  it('toasts anything else, and leaves the paywall shut', () => {
    const store = makeStore();
    const raised = reportGenerationError(new ApiError('Server exploded', 500), {
      context: 'Start generation',
      store,
    });

    expect(raised).toBe(false);
    expect(store.getState().dialogs[PAYWALL_DIALOG]).toBeFalsy();
    expect(store.getState().toasts.at(-1)?.severity).toBe('error');
    expect(store.getState().toasts.at(-1)?.message).toContain('Start generation');
  });

  it('does not mistake an ordinary 402-shaped ApiError for the typed one', () => {
    // The class is the contract, not the status: `mapError` in music_client is
    // the single place a status becomes a kind of failure.
    const store = makeStore();
    reportGenerationError(new ApiError('Payment Required', 402), { store });
    expect(store.getState().dialogs[PAYWALL_DIALOG]).toBeFalsy();
  });
});
