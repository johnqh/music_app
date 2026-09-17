import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@/app-library';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@/app-library';
import { chordScore, twinkleScore } from '@/app-library';
import { exportMidi } from '@/app-library';
import { analyzeMidi } from '@/app-library';
import { MidiImportWizard } from '@/components/dialogs/MidiImportWizard';
import { Toasts } from '@/components/layout/Toasts';
import type { EditorStoreApi, MidiImportOptions, MidiImportResult } from '@/app-library';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';

function makeStore(): EditorStoreApi {
  return createAppStore({ context: testStoreContext() });
}

// The dialog resolves its import service from the composition root, so the
// test harness has to be installed -- it also registers the mock platform.
beforeEach(() => {
  installTestAppServices();
});

afterEach(() => {
  resetTestAppServices();
});

/** A real Standard MIDI File, round-tripped from a fixture score via the Task 7 exporter -- the same pattern `analyze.test.ts` uses. */
function fixtureMidiFile(name = 'fixture.mid'): File {
  const bytes = exportMidi(chordScore());
  return new File([bytes.buffer as ArrayBuffer], name, { type: 'audio/midi' });
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>, file: File): Promise<void> {
  const input = screen.getByLabelText('MIDI file input', { selector: 'input' });
  await user.upload(input, file);
}

describe('MidiImportWizard', () => {
  it('renders a per-track summary once a MIDI file is chosen', async () => {
    const store = makeStore();
    render(<MidiImportWizard open onClose={vi.fn()} store={store} />);
    const user = userEvent.setup();

    await chooseFile(user, fixtureMidiFile());

    await waitFor(() =>
      expect(screen.getByRole('table', { name: 'MIDI track summary' })).toBeInTheDocument(),
    );
    expect(screen.getByText(/\d+ tracks?,/)).toBeInTheDocument();
    // The performance-timing warning (spec §15) is always shown once a file is loaded.
    expect(screen.getByText(/performance timing/i)).toBeInTheDocument();
  });

  it('importing into a fresh store (no project open) creates a new project via a single command, no confirmation needed', async () => {
    const store = makeStore();
    const onImportedNewProject = vi.fn();
    render(
      <MidiImportWizard
        open
        onClose={vi.fn()}
        store={store}
        onImportedNewProject={onImportedNewProject}
      />,
    );
    const user = userEvent.setup();

    await chooseFile(user, fixtureMidiFile());
    await waitFor(() =>
      expect(screen.getByRole('table', { name: 'MIDI track summary' })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(store.getState().projectId).not.toBeNull());
    expect(store.getState().score).not.toBeNull();
    expect(onImportedNewProject).toHaveBeenCalledWith(store.getState().projectId);
  });

  it('importing into an already-open project confirms, then replaces the score as one undoable command', async () => {
    const store = makeStore();
    await store.getState().newProject({ name: 'Existing', score: twinkleScore() });
    const originalScoreId = store.getState().score!.id;

    render(<MidiImportWizard open onClose={vi.fn()} store={store} />);
    const user = userEvent.setup();

    await chooseFile(user, fixtureMidiFile());
    await waitFor(() =>
      expect(screen.getByRole('table', { name: 'MIDI track summary' })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Import' }));

    const dialog = await screen.findByRole('dialog', { name: 'Replace current score' });
    // The score hasn't been replaced yet -- confirmation is required first.
    expect(store.getState().score!.id).toBe(originalScoreId);

    await user.click(within(dialog).getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(store.getState().score!.id).not.toBe(originalScoreId));
    // Exactly one undoable command was dispatched for the whole import.
    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().score!.id).toBe(originalScoreId);
  });

  it('Preview shows a note count and a short text preview', async () => {
    const store = makeStore();
    render(<MidiImportWizard open onClose={vi.fn()} store={store} />);
    const user = userEvent.setup();

    await chooseFile(user, fixtureMidiFile());
    await waitFor(() =>
      expect(screen.getByRole('table', { name: 'MIDI track summary' })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Preview import' }));

    await waitFor(() => expect(screen.getByText(/notes after import\./)).toBeInTheDocument());
  });

  it('excluding a track via its Include checkbox is reflected in the preview note count', async () => {
    const store = makeStore();
    render(<MidiImportWizard open onClose={vi.fn()} store={store} />);
    const user = userEvent.setup();

    await chooseFile(user, fixtureMidiFile());
    await waitFor(() =>
      expect(screen.getByRole('table', { name: 'MIDI track summary' })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await waitFor(() => expect(screen.getByText(/notes after import\./)).toBeInTheDocument());
    const withAllTracks = screen.getByText(/notes after import\./).textContent;

    const includeCheckboxes = screen.getAllByRole('checkbox', { name: /Include track:/ });
    await user.click(includeCheckboxes[0]);
    await user.click(screen.getByRole('button', { name: 'Preview import' }));

    await waitFor(() =>
      expect(screen.getByText(/notes after import\./).textContent).not.toBe(withAllTracks),
    );
  });

  it('a failed import (commit step) shows an error toast, not a silent failure', async () => {
    const store = makeStore();
    const failingService = {
      analyze: (buffer: ArrayBuffer) => Promise.resolve(analyzeMidi(buffer)),
      import: vi.fn().mockRejectedValue(new Error('corrupt track data')),
    };
    render(
      <>
        <MidiImportWizard open onClose={vi.fn()} store={store} midiService={failingService} />
        <Toasts store={store} />
      </>,
    );
    const user = userEvent.setup();

    await chooseFile(user, fixtureMidiFile());
    await waitFor(() =>
      expect(screen.getByRole('table', { name: 'MIDI track summary' })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Import' }));

    // Queried by text, not `getByRole('alert')`: the wizard's own Dialog is
    // still open (so the user can retry), and MUI's Modal marks every other
    // top-level element -- including the Toasts Snackbar, mounted as a
    // sibling -- `aria-hidden` while it's open, which role-based queries
    // correctly treat as inaccessible even though it's still visible.
    await waitFor(() =>
      expect(screen.getByText('MIDI import failed: corrupt track data')).toBeInTheDocument(),
    );
    expect(store.getState().projectId).toBeNull();
  });
});

describe('MidiImportWizard: the option fields', () => {
  function spyService() {
    return {
      analyze: (buffer: ArrayBuffer) => Promise.resolve(analyzeMidi(buffer)),
      import: vi.fn<(buffer: ArrayBuffer, options: MidiImportOptions) => Promise<MidiImportResult>>(
        async () => ({ score: twinkleScore(), warnings: [] }),
      ),
    };
  }

  async function loaded(service: ReturnType<typeof spyService>) {
    render(<MidiImportWizard open onClose={vi.fn()} store={makeStore()} midiService={service} />);
    const user = userEvent.setup();
    await chooseFile(user, fixtureMidiFile());
    await waitFor(() =>
      expect(screen.getByRole('table', { name: 'MIDI track summary' })).toBeInTheDocument(),
    );
    return user;
  }

  /*
    The split point was written `Number(text) || 60`, which reads note 0 as
    falsy and quietly moves the split to middle C. A split at the lowest note
    is a strange request, not an absent one.
  */
  it('keeps a split point of 0 rather than moving it to middle C', async () => {
    const service = spyService();
    const user = await loaded(service);
    await user.click(screen.getByRole('checkbox', { name: 'Piano staff split' }));
    const field = screen.getByLabelText('Split point (MIDI note number)');
    await user.clear(field);
    await user.type(field, '0');
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await waitFor(() => expect(service.import).toHaveBeenCalled());
    expect(service.import.mock.calls.at(-1)![1]).toMatchObject({ splitPointMidi: 0 });
  });

  it('clamps a split point past the top of the MIDI range', async () => {
    const service = spyService();
    const user = await loaded(service);
    await user.click(screen.getByRole('checkbox', { name: 'Piano staff split' }));
    const field = screen.getByLabelText('Split point (MIDI note number)');
    await user.clear(field);
    await user.type(field, '200');
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await waitFor(() => expect(service.import).toHaveBeenCalled());
    expect(service.import.mock.calls.at(-1)![1]).toMatchObject({ splitPointMidi: 127 });
  });

  it('offers no Import once every track is excluded', async () => {
    // Importing nothing builds an empty score, which is not what anybody means.
    await loaded(spyService());
    const user = userEvent.setup();
    for (const box of screen.getAllByRole('checkbox', { name: /Include track:/ }))
      await user.click(box);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
});

describe('accessibility (spec §27)', () => {
  it('every interactive control has an accessible name, before and after a file is chosen', async () => {
    const store = makeStore();
    render(<MidiImportWizard open onClose={vi.fn()} store={store} />);
    const user = userEvent.setup();

    const checkAllControls = () => {
      const dialog = screen.getByRole('dialog');
      for (const button of within(dialog).getAllByRole('button'))
        expect(button).toHaveAccessibleName();
      for (const checkbox of within(dialog).queryAllByRole('checkbox'))
        expect(checkbox).toHaveAccessibleName();
      for (const combobox of within(dialog).queryAllByRole('combobox'))
        expect(combobox).toHaveAccessibleName();
    };

    checkAllControls();

    await chooseFile(user, fixtureMidiFile());
    await waitFor(() =>
      expect(screen.getByRole('table', { name: 'MIDI track summary' })).toBeInTheDocument(),
    );

    checkAllControls();
  });
});
