import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import { twinkleScore } from '@/test/fixtures';
import { exportMusicXml } from '@/adapters/musicxml/export';
import { MusicXmlImportDialog } from '@/components/dialogs/MusicXmlImportDialog';
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
});
