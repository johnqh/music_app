/**
 * Print waits for the pages: until every system has been drawn the button is
 * a spinner and pressing it prints nothing. `PrintSystem` is replaced here so
 * the test decides when each system reports itself drawn — the real one draws
 * inside the same commit, which leaves no moment to look at in between.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createAppStore, stressScore, testStoreContext } from '@/app-library';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';

const drawnCallbacks = new Map<number, () => void>();

vi.mock('@/features/print/PrintSystem', () => ({
  PrintSystem: ({
    slice,
    onDrawn,
  }: {
    slice: { systemIndex: number };
    onDrawn?: (systemIndex: number) => void;
  }) => {
    drawnCallbacks.set(slice.systemIndex, () => onDrawn?.(slice.systemIndex));
    return <div data-testid={`print-system-${slice.systemIndex}`} />;
  },
}));

const { PrintView } = await import('@/features/print/PrintView');

describe('PrintView: the Print button waits for the pages', () => {
  beforeEach(() => {
    installTestAppServices();
    drawnCallbacks.clear();
  });
  afterEach(() => {
    cleanup();
    resetTestAppServices();
  });

  it('spins until every system is drawn, and prints nothing before then', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(stressScore(2, 40));
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<PrintView store={store} onBack={() => {}} />);

    const preparing = screen.getByRole('button', { name: 'Preparing pages…' });
    expect(preparing).toBeDisabled();
    expect(preparing).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(preparing);
    expect(print).not.toHaveBeenCalled();

    const callbacks = [...drawnCallbacks.values()];
    expect(callbacks.length).toBeGreaterThan(1);
    act(() => callbacks.slice(0, -1).forEach((drawn) => drawn()));
    expect(screen.getByRole('button', { name: 'Preparing pages…' })).toBeDisabled();

    act(() => callbacks.at(-1)!());
    const ready = screen.getByRole('button', { name: 'Print' });
    expect(ready).toBeEnabled();
    fireEvent.click(ready);
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });
});
