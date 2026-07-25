import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import type { MusicGenerationProvider } from '@sudobility/music_types';
import { FakeGenerationProvider } from '@sudobility/music_lib';

// Late-binding provider shim (replaces the deleted registry): the store's
// context gets a delegator so tests can swap providers after creation.
let injectedProvider: MusicGenerationProvider | undefined;
function setProvider(p: MusicGenerationProvider): void {
  injectedProvider = p;
}
function resetProvider(): void {
  injectedProvider = undefined;
}
const defaultFakeProvider = new FakeGenerationProvider();
const delegatingProvider: MusicGenerationProvider = {
  id: 'delegator',
  name: 'Delegator',
  generateScore: (req, signal) => (injectedProvider ?? defaultFakeProvider).generateScore(req, signal),
  regenerateRegion: (req, signal) => (injectedProvider ?? defaultFakeProvider).regenerateRegion(req, signal),
};
import { GenerationPanel } from '@/features/generation/GenerationPanel';
import type { GenerationStoreApi } from '@/features/generation/preview';
import type {
  GenerateScoreRequest,
  GenerateScoreResult,
  RegenerateRegionResult,
} from '@sudobility/music_types';

let dbCounter = 0;

function makeStore(): GenerationStoreApi {
  dbCounter += 1;
  return createAppStore({ context: testStoreContext({ provider: delegatingProvider }) });
}

afterEach(async () => {
  resetProvider();
});

function renderPanel(store: GenerationStoreApi) {
  render(<GenerationPanel store={store} />);
}

/** A provider whose `generateScore` call stays pending until resolved by hand (mirrors generation-slice.test.ts's ControllableProvider). */
class ControllableProvider implements MusicGenerationProvider {
  readonly id = 'controllable';
  readonly name = 'Controllable Test Provider';
  readonly calls: Array<{ request: GenerateScoreRequest; resolve: (r: GenerateScoreResult) => void }> = [];

  generateScore(request: GenerateScoreRequest, signal?: AbortSignal): Promise<GenerateScoreResult> {
    return new Promise((resolve, reject) => {
      this.calls.push({ request, resolve });
      signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
  }

  regenerateRegion(): Promise<RegenerateRegionResult> {
    return new Promise(() => {});
  }
}

describe('GenerationPanel', () => {
  it('Generate is disabled until a prompt is entered', async () => {
    const store = makeStore();
    renderPanel(store);
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Create a gentle piano melody');

    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled();
  });

  it('shows the full six-instrument checklist, with Piano checked by default', () => {
    const store = makeStore();
    renderPanel(store);

    for (const label of ['Piano', 'Electric Piano', 'Strings', 'Bass', 'Synth Lead', 'Drums']) {
      expect(screen.getByRole('checkbox', { name: `Include ${label}` })).toBeInTheDocument();
    }
    expect(screen.getByRole('checkbox', { name: 'Include Piano' })).toBeChecked();
    for (const label of ['Electric Piano', 'Strings', 'Bass', 'Synth Lead', 'Drums']) {
      expect(screen.getByRole('checkbox', { name: `Include ${label}` })).not.toBeChecked();
    }
  });

  it('Generate is disabled when every instrument is unchecked', async () => {
    const store = makeStore();
    renderPanel(store);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Create a gentle piano melody');

    await user.click(screen.getByRole('checkbox', { name: 'Include Piano' })); // Piano is checked by default; this unchecks it

    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  it('selecting a preset prompt fills the prompt field', async () => {
    const store = makeStore();
    renderPanel(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Preset prompts' }));
    await user.click(await screen.findByRole('menuitem', { name: /gentle eight-measure piano melody/i }));

    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue(
      'Create a gentle eight-measure piano melody in C major',
    );
  });

  it('clicking Generate produces a committed score reflecting the selected instrumentation and measures', async () => {
    const store = makeStore();
    renderPanel(store);
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Create a gentle piano melody');
    await user.click(screen.getByRole('checkbox', { name: 'Include Bass' }));
    const measuresField = screen.getByRole('spinbutton', { name: 'Measures' });
    await user.clear(measuresField);
    await user.type(measuresField, '4');

    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await vi.waitFor(() => expect(store.getState().score).not.toBeNull());
    const score = store.getState().score!;
    expect(score.tracks.map((t) => t.name).sort()).toEqual(['Bass', 'Piano']);
    expect(score.tracks[0].measures).toHaveLength(4);
  });

  it('shows progress and a Cancel button while a generate() call is pending; Cancel stops it', async () => {
    const provider = new ControllableProvider();
    setProvider(provider);
    const store = makeStore();
    renderPanel(store);
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Create a gentle piano melody');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByLabelText('Generating')).toBeInTheDocument();
    expect(store.getState().pending).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(store.getState().pending).toBe(false);
    expect(store.getState().error).toBeNull();
    expect(screen.queryByLabelText('Generating')).not.toBeInTheDocument();
  });

  it('shows a generation error', () => {
    const store = makeStore();
    store.setState({ error: 'Something went wrong' });
    renderPanel(store);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('every interactive control has an accessible name', () => {
    const store = makeStore();
    renderPanel(store);
    const panel = screen.getByLabelText('Generation panel');
    for (const el of within(panel).getAllByRole('button')) {
      expect(el).toHaveAccessibleName();
    }
    for (const el of within(panel).getAllByRole('checkbox')) {
      expect(el).toHaveAccessibleName();
    }
  });
});
