import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import { twinkleScore } from '@/test/fixtures';
import { exportMusicXml } from '@/adapters/musicxml/export';
import { MusicXmlImportDialog } from '@/components/dialogs/MusicXmlImportDialog';
import { Toasts } from '@/components/layout/Toasts';
import type { EditorStoreApi } from '@/features/score-editor/editing';

let db: ScoreSmithDb;
let dbCounter = 0;

function makeStore(): EditorStoreApi {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-musicxmlwizard-${dbCounter}`);
  return createAppStore({ db });
}

afterEach(async () => {
  await db?.delete();
});

function fixtureFile(name = 'fixture.musicxml'): File {
  const xml = exportMusicXml(twinkleScore());
  return new File([xml], name, { type: 'application/vnd.recordare.musicxml+xml' });
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>, file: File): Promise<void> {
  const input = screen.getByLabelText('MusicXML file input', { selector: 'input' });
  await user.upload(input, file);
}

describe('MusicXmlImportDialog', () => {
  it('shows a track/note summary once a MusicXML file is chosen', async () => {
    const store = makeStore();
    render(<MusicXmlImportDialog open onClose={vi.fn()} store={store} />);
    const user = userEvent.setup();

    await chooseFile(user, fixtureFile());

    await waitFor(() => expect(screen.getByText(/track\(s\)/)).toBeInTheDocument());
  });

  it('importing into a fresh store creates a new project via a single command', async () => {
    const store = makeStore();
    const onImportedNewProject = vi.fn();
    render(<MusicXmlImportDialog open onClose={vi.fn()} store={store} onImportedNewProject={onImportedNewProject} />);
    const user = userEvent.setup();

    await chooseFile(user, fixtureFile());
    await waitFor(() => expect(screen.getByText(/track\(s\)/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(store.getState().projectId).not.toBeNull());
    expect(onImportedNewProject).toHaveBeenCalledWith(store.getState().projectId);
  });

  it('importing into an already-open project confirms, then replaces the score as one undoable command', async () => {
    const store = makeStore();
    await store.getState().newProject({ name: 'Existing', score: twinkleScore() });
    const originalScoreId = store.getState().score!.id;

    render(<MusicXmlImportDialog open onClose={vi.fn()} store={store} />);
    const user = userEvent.setup();

    await chooseFile(user, fixtureFile());
    await waitFor(() => expect(screen.getByText(/track\(s\)/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Import' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace current score' });
    expect(store.getState().score!.id).toBe(originalScoreId);

    await user.click(within(dialog).getByRole('button', { name: 'Replace' }));

    expect(store.getState().score!.id).not.toBe(originalScoreId);
    expect(store.getState().canUndo).toBe(true);
  });

  it('forceNewProject always creates a new project directly, with no replace-confirmation, even if the store has a lingering projectId', async () => {
    const store = makeStore();
    // Simulates the dashboard's scenario (Task 16 review finding): the
    // shared app-wide store still has a projectId from a previously-open
    // project even though the dashboard itself has no "current project".
    await store.getState().newProject({ name: 'Stale', score: twinkleScore() });
    const staleScoreId = store.getState().score!.id;
    const onImportedNewProject = vi.fn();

    render(
      <MusicXmlImportDialog open onClose={vi.fn()} store={store} forceNewProject onImportedNewProject={onImportedNewProject} />,
    );
    const user = userEvent.setup();

    await chooseFile(user, fixtureFile());
    await waitFor(() => expect(screen.getByText(/track\(s\)/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Import' }));

    // No confirmation dialog: proceeds straight to creating a new project.
    expect(screen.queryByRole('dialog', { name: 'Replace current score' })).not.toBeInTheDocument();
    await waitFor(() => expect(store.getState().score!.id).not.toBe(staleScoreId));
    expect(onImportedNewProject).toHaveBeenCalledWith(store.getState().projectId);
  });

  it('a failed import (commit step) shows an error toast, not a silent failure', async () => {
    const store = makeStore();
    store.setState({ newProject: vi.fn().mockRejectedValue(new Error('disk full')) });

    render(
      <>
        <MusicXmlImportDialog open onClose={vi.fn()} store={store} />
        <Toasts store={store} />
      </>,
    );
    const user = userEvent.setup();

    await chooseFile(user, fixtureFile());
    await waitFor(() => expect(screen.getByText(/track\(s\)/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Import' }));

    // Queried by text, not `getByRole('alert')`: the dialog is still open
    // (nothing to close on failure), and MUI's Modal marks every other
    // top-level element -- including the Toasts Snackbar, mounted as a
    // sibling -- `aria-hidden` while it's open.
    await waitFor(() => expect(screen.getByText('MusicXML import failed: disk full')).toBeInTheDocument());
    expect(store.getState().projectId).toBeNull();
  });
});
