import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { ScoreSmithDb } from '@sudobility/music_lib';
import { createProject } from '@sudobility/music_lib';
import { createEmptyScore } from '@sudobility/music_lib';
import { DeveloperSettingsDialog } from '@/components/dialogs/DeveloperSettingsDialog';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import * as downloadExports from '@sudobility/music_lib';

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

  it('Run benchmark runs runBenchmark with the given sizes, shows a summary, and logs a console.table', async () => {
    const store = makeStore();
    const consoleTable = vi.spyOn(console, 'table').mockImplementation(() => {});
    render(
      <DeveloperSettingsDialog
        open
        onClose={vi.fn()}
        store={store}
        db={db}
        benchmarkSizes={[{ trackCount: 1, measureCount: 2 }]}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Run benchmark' }));

    expect(await screen.findByText(/Benchmark complete: 1 size\(s\) timed/)).toBeInTheDocument();
    expect(consoleTable).toHaveBeenCalledTimes(1);
    const rows = consoleTable.mock.calls[0][0] as Array<{ operation: string }>;
    expect(rows.map((r) => r.operation)).toContain('validateScore');

    consoleTable.mockRestore();
  });

  it('Export diagnostic JSON includes the last benchmark report once one has been run', async () => {
    const store = makeStore();
    const consoleTable = vi.spyOn(console, 'table').mockImplementation(() => {});
    const downloadBlobSpy = vi.spyOn(downloadExports, 'downloadBlob').mockImplementation(() => {});

    render(
      <DeveloperSettingsDialog
        open
        onClose={vi.fn()}
        store={store}
        db={db}
        benchmarkSizes={[{ trackCount: 1, measureCount: 2 }]}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Run benchmark' }));
    await screen.findByText(/Benchmark complete/);

    await user.click(screen.getByRole('button', { name: 'Export diagnostic JSON' }));

    expect(downloadBlobSpy).toHaveBeenCalledTimes(1);
    const [name, blob] = downloadBlobSpy.mock.calls[0];
    expect(name).toBe('scoresmith-diagnostics.json');
    const text = await (blob as Blob).text();
    const diagnostics = JSON.parse(text) as { benchmark: { sizes: unknown[] } | null };
    expect(diagnostics.benchmark).not.toBeNull();
    expect(diagnostics.benchmark!.sizes).toHaveLength(1);

    consoleTable.mockRestore();
    downloadBlobSpy.mockRestore();
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

describe('accessibility (spec §27)', () => {
  it('every interactive control has an accessible name', () => {
    const store = makeStore();
    render(<DeveloperSettingsDialog open onClose={vi.fn()} store={store} db={db} />);
    const dialog = screen.getByRole('dialog');
    for (const button of within(dialog).getAllByRole('button')) expect(button).toHaveAccessibleName();
    for (const checkbox of within(dialog).getAllByRole('checkbox')) expect(checkbox).toHaveAccessibleName();
    for (const textbox of within(dialog).getAllByRole('textbox')) expect(textbox).toHaveAccessibleName();
  });
});
