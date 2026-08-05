import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  computeLayout,
  createAppStore,
  testStoreContext,
  twoTrackScore,
} from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import { printRenderOptions } from '@/features/print/print-layout';
import { PrintView } from '@/features/print/PrintView';

function makeStore(): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twoTrackScore());
  return store;
}

const systemCount = (trackIds: string[] = []) =>
  computeLayout(twoTrackScore(), printRenderOptions(trackIds)).systems.length;

const printedSystems = (container: HTMLElement) =>
  container.querySelectorAll('[data-testid^="print-system-"]');

describe('PrintView', () => {
  beforeEach(() => installTestAppServices());
  afterEach(() => resetTestAppServices());

  it('renders every system of the score', () => {
    const store = makeStore();
    const { container } = render(<PrintView store={store} onBack={() => {}} />);
    expect(printedSystems(container)).toHaveLength(systemCount());
  });

  it('prints the whole score by default', () => {
    const store = makeStore();
    render(<PrintView store={store} onBack={() => {}} />);
    expect(screen.getByLabelText('What to print')).toHaveTextContent('Whole score');
  });

  it('warns about a single track, and only about a single track', async () => {
    // Until transposition and multi-measure rests land, a filtered track is a
    // lead sheet, not a part. Saying so is the honest thing.
    const user = userEvent.setup();
    const store = makeStore();
    render(<PrintView store={store} onBack={() => {}} />);

    expect(screen.queryByText(/not yet an orchestral part/i)).toBeNull();

    await user.click(screen.getByLabelText('What to print'));
    await user.click(screen.getByRole('option', { name: store.getState().score!.tracks[0].name }));

    expect(screen.getByText(/not yet an orchestral part/i)).toBeInTheDocument();
  });

  it('calls print when asked', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<PrintView store={store} onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Print' }));

    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });

  it('goes back to the editor', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    const onBack = vi.fn();
    render(<PrintView store={store} onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: 'Back to editor' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('says so plainly when there is no score', () => {
    const store = createAppStore({ context: testStoreContext() }) as EditorStoreApi;
    const { container } = render(<PrintView store={store} onBack={() => {}} />);
    expect(printedSystems(container)).toHaveLength(0);
    expect(screen.getByText(/nothing to print/i)).toBeInTheDocument();
  });
});
