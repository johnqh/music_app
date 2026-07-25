import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import { createProject } from '@/services/persistence/projects';
import { createEmptyScore } from '@/domain/score/factory';
import { DeveloperSettingsDialog } from '@/components/dialogs/DeveloperSettingsDialog';
import type { EditorStoreApi } from '@/features/score-editor/editing';

let db: ScoreSmithDb;
let dbCounter = 0;

function makeStore(): EditorStoreApi {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-devsettings-${dbCounter}`);
  return createAppStore({ db });
}

afterEach(async () => {
  await db?.delete();
});

describe('DeveloperSettingsDialog', () => {
  it('editing the seed field updates devSettings.seed', async () => {
    const store = makeStore();
    render(<DeveloperSettingsDialog open onClose={vi.fn()} store={store} db={db} />);
    const user = userEvent.setup();

    const field = screen.getByLabelText('Mock-provider seed');
    await user.clear(field);
    await user.type(field, 'my-seed');

    expect(store.getState().devSettings.seed).toBe('my-seed');
  });

  it('toggling "Show tick positions" updates devSettings.showTicks', async () => {
    const store = makeStore();
    render(<DeveloperSettingsDialog open onClose={vi.fn()} store={store} db={db} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Show tick positions'));

    expect(store.getState().devSettings.showTicks).toBe(true);
  });

  it('Generate stress-test score replaces the current score with a large one', async () => {
    const store = makeStore();
    store.getState().setScore(createEmptyScore({ title: 'Small', measures: 1 }));
    render(<DeveloperSettingsDialog open onClose={vi.fn()} store={store} db={db} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Generate stress-test score' }));

    expect(store.getState().score!.tracks.length).toBeGreaterThanOrEqual(20);
    expect(store.getState().score!.tracks[0].measures.length).toBeGreaterThanOrEqual(500);
  });

  it('Reset local database requires confirmation, then clears every project', async () => {
    const store = makeStore();
    await createProject(db, { name: 'Existing project', score: createEmptyScore({ title: 'Existing project' }) });
    render(<DeveloperSettingsDialog open onClose={vi.fn()} store={store} db={db} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Reset local database' }));
    const dialog = screen.getByRole('dialog', { name: /Reset local database/ });
    await user.click(within(dialog).getByRole('button', { name: 'Reset' }));

    expect(await db.projects.count()).toBe(0);
  });
});
