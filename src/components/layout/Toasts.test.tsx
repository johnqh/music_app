import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { Toasts } from '@/components/layout/Toasts';
import type { EditorStoreApi } from '@/features/score-editor/editing';

function makeStore(): EditorStoreApi {
  return createAppStore({ context: testStoreContext() });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Toasts', () => {
  it('shows nothing when there are no toasts', () => {
    const store = makeStore();
    render(<Toasts store={store} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the oldest queued toast', () => {
    const store = makeStore();
    store.getState().pushToast({ message: 'First', severity: 'info' });
    store.getState().pushToast({ message: 'Second', severity: 'error' });
    render(<Toasts store={store} />);

    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
  });

  it('dismissing the current toast reveals the next one in the queue', async () => {
    const store = makeStore();
    store.getState().pushToast({ message: 'First', severity: 'info' });
    store.getState().pushToast({ message: 'Second', severity: 'error' });
    render(<Toasts store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /close/i }));

    await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());
  });

  it('a toast with a retry action renders and runs it, then dismisses the toast', async () => {
    const store = makeStore();
    const onRetry = vi.fn();
    store.getState().pushToast({
      message: 'Import failed',
      severity: 'error',
      action: { label: 'Retry', onClick: onRetry },
    });
    render(<Toasts store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Import failed')).not.toBeInTheDocument());
  });
});
