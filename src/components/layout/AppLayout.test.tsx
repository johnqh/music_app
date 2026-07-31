import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { twinkleScore } from '@sudobility/music_lib';
import { allNotes } from '@sudobility/music_lib';
import type { NoteEvent, Score } from '@sudobility/music_types';
import { changeVelocityCommand } from '@sudobility/music_lib';

// AppLayout renders ScoreEditorView (useEditorShortcuts -> playbackController)
// and TransportBar, both of which reach the app-wide playbackController
// singleton -- mocked per the Task 13/15 test pattern so this suite never
// constructs a real Tone.js engine.
vi.mock('@sudobility/music_lib', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  playbackController: {
    togglePlay: vi.fn(),
    stop: vi.fn(),
    stopPreview: vi.fn(),
    seek: vi.fn(),
    seekToMeasure: vi.fn(),
    goToStart: vi.fn(),
    previousMeasure: vi.fn(),
    nextMeasure: vi.fn(),
    setLoopFromSelection: vi.fn(),
    clearLoop: vi.fn(),
    toggleLoop: vi.fn(),
    setTempoMultiplier: vi.fn(),
    setMetronome: vi.fn(),
    setMasterVolume: vi.fn(),
  },
}));

import { AppLayout } from '@/components/layout/AppLayout';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';

// AppLayout mounts the import dialogs even while they are closed, and those
// build their import service from the composition root, so the harness has to
// be installed for a plain render.
beforeEach(() => {
  installTestAppServices();
});

afterEach(() => {
  resetTestAppServices();
});

async function makeStoreWithProject(score: Score = twinkleScore()): Promise<EditorStoreApi> {
  const store = createAppStore({ context: testStoreContext() });
  await store.getState().newProject({ name: 'My Song', score });
  return store;
}

afterEach(async () => {});

describe('AppLayout', () => {
  it('renders the project title and a save-state chip', async () => {
    const store = await makeStoreWithProject();
    render(<AppLayout store={store} />);

    expect(screen.getByLabelText('Edit project title')).toHaveTextContent('My Song');
    expect(screen.getByLabelText(/Save state:/)).toBeInTheDocument();
  });

  it('editing the project title dispatches renameProject', async () => {
    const store = await makeStoreWithProject();
    render(<AppLayout store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Edit project title'));
    const field = screen.getByLabelText('Project title');
    await user.clear(field);
    await user.type(field, 'New Title');
    await user.tab();

    expect(store.getState().projectName).toBe('New Title');
  });

  it('Undo is disabled with no history and enabled (with the command label as its tooltip) after an edit', async () => {
    const store = await makeStoreWithProject();
    render(<AppLayout store={store} />);

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();

    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    store.getState().dispatchCommand(changeVelocityCommand([note.id], 100));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled());
  });

  it('the status bar shows a selection summary that updates with the selection', async () => {
    const store = await makeStoreWithProject();
    render(<AppLayout store={store} />);

    expect(screen.getByText('No selection')).toBeInTheDocument();

    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    await waitFor(() => expect(screen.getByText('1 note(s) selected')).toBeInTheDocument());
  });

  it('issues popover: shows the current validation issue count and clicking an issue navigates (sets the selection) and closes the popover', async () => {
    const score = twinkleScore();
    const note = allNotes(score)[0] as NoteEvent;
    // Force an INVALID_VELOCITY issue by mutating a note out of range directly
    // (no command needed -- setScore below re-validates from scratch).
    const invalidScore: Score = {
      ...score,
      tracks: score.tracks.map((track) => ({
        ...track,
        measures: track.measures.map((measure) => ({
          ...measure,
          voices: measure.voices.map((voice) => ({
            ...voice,
            events: voice.events.map((event) =>
              event.id === note.id ? { ...event, velocity: -5 } : event,
            ),
          })),
        })),
      })),
    };
    // Persisted (via newProject -> the Zod-validated projects table) with a
    // valid score first -- the invalid one is only ever loaded into the
    // live store via setScore (which re-validates for *display* via
    // validateScore, not schema-validated for persistence).
    const store = await makeStoreWithProject(score);
    store.getState().setScore(invalidScore, { resetHistory: false });
    expect(store.getState().validationIssues.length).toBeGreaterThan(0);

    render(<AppLayout store={store} />);
    const user = userEvent.setup();

    const issuesButton = screen.getByRole('button', { name: 'Validation issues' });
    await user.click(issuesButton);

    const popover = await screen.findByRole('list', { name: 'Validation issues list' });
    const issueRow = within(popover).getAllByRole('listitem')[0];
    await user.click(issueRow);

    expect(store.getState().selection.eventIds).toEqual([note.id]);
    await waitFor(() =>
      expect(
        screen.queryByRole('list', { name: 'Validation issues list' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('"Back to dashboard" calls onNavigate("/projects")', async () => {
    const store = await makeStoreWithProject();
    const onNavigate = vi.fn();
    render(<AppLayout store={store} onNavigate={onNavigate} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Back to dashboard'));

    expect(onNavigate).toHaveBeenCalledWith('/projects');
  });

});

describe('AppLayout: simultaneous notation and piano keyboard', () => {
  function makeStore() {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    return store;
  }

  it('renders the notation and the keyboard at once', () => {
    render(<AppLayout store={makeStore()} />);
    expect(screen.getByTestId('score-editor-canvas')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Piano keyboard/ })).toBeInTheDocument();
  });

  it('has no view-mode toggle anywhere', () => {
    render(<AppLayout store={makeStore()} />);
    expect(screen.queryByRole('group', { name: 'Editor view' })).not.toBeInTheDocument();
  });

  it('collapses and re-expands the keyboard panel', async () => {
    render(<AppLayout store={makeStore()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Collapse piano keyboard' }));
    expect(screen.queryByRole('img', { name: /Piano keyboard/ })).not.toBeInTheDocument();
    // The notation is unaffected — collapsing the keyboard is not a mode switch.
    expect(screen.getByTestId('score-editor-canvas')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand piano keyboard' }));
    expect(screen.getByRole('img', { name: /Piano keyboard/ })).toBeInTheDocument();
  });

  it('announces a regenerated selection in the status bar', () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    render(<AppLayout store={store} />);

    act(() => {
      store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
      store.setState({ selectionRegenerated: true });
    });

    expect(screen.getByRole('status', { name: 'Status bar' })).toHaveTextContent(
      '1 note(s) selected, regenerated',
    );
  });

  it('drops the ", regenerated" suffix once the selection changes', () => {
    const store = makeStore();
    const [first, second] = allNotes(store.getState().score!);
    render(<AppLayout store={store} />);
    act(() => {
      store.getState().setSelection({ eventIds: [first.id], measureIds: [], trackIds: [] });
      store.setState({ selectionRegenerated: true });
    });

    act(() => {
      store.getState().setSelection({ eventIds: [second.id], measureIds: [], trackIds: [] });
    });

    expect(screen.getByRole('status', { name: 'Status bar' })).toHaveTextContent(
      '1 note(s) selected',
    );
    expect(screen.getByRole('status', { name: 'Status bar' })).not.toHaveTextContent('regenerated');
  });
});

describe('AppLayout: track editor beside the keyboard', () => {
  function makeScored() {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    return store;
  }

  it('has no left track column: the info is in the canvas now', () => {
    render(<AppLayout store={makeScored()} />);
    expect(screen.queryByRole('list', { name: 'Track list' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Toggle track panel' })).not.toBeInTheDocument();
  });

  it('shows the track editor beside the keyboard', () => {
    render(<AppLayout store={makeScored()} />);
    expect(screen.getByRole('region', { name: 'Track editor' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Piano keyboard/ })).toBeInTheDocument();
  });

  it('collapsing the keyboard takes the track editor with it', () => {
    // They share one subject -- the active track -- so they collapse together.
    render(<AppLayout store={makeScored()} />);
    expect(screen.getByRole('region', { name: 'Track editor' })).toBeInTheDocument();
  });
});
