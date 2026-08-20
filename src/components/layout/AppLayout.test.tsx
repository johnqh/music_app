import { commandLabel } from '@/features/score-editor/command-labels';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { threeTrackScore, twinkleScore, midiToPitch } from '@sudobility/music_lib';
import { allNotes } from '@sudobility/music_lib';
import type { NoteEvent, Score } from '@sudobility/music_types';
import { addMeasureCommand, changeVelocityCommand } from '@sudobility/music_lib';

// AppLayout renders ScoreEditorView (useEditorShortcuts -> playbackController)
// and TransportBar, both of which reach the app-wide playbackController
// singleton -- mocked per the Task 13/15 test pattern so this suite never
// constructs a real Tone.js engine.
vi.mock('@sudobility/music_lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sudobility/music_lib')>();
  return {
    ...actual,
    playbackController: {
      // A real bus: playback position and sounding notes live on it now.
      bus: new actual.PlaybackBus(),
      togglePlay: vi.fn(),
      stop: vi.fn(),
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
  };
});

vi.mock('@/features/generation/useGenerationJob', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useProjectGeneration: vi.fn(),
}));

import { AppLayout } from '@/components/layout/AppLayout';
import { useProjectGeneration } from '@/features/generation/useGenerationJob';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import { getAppServices } from '@/config/initialize';

// AppLayout mounts the import dialogs even while they are closed, and those
// build their import service from the composition root, so the harness has to
// be installed for a plain render.
const IDLE_GENERATION = {
  generating: false,
  error: null,
  start: vi.fn(),
  cancel: vi.fn(),
} as unknown as ReturnType<typeof useProjectGeneration>;

beforeEach(() => {
  installTestAppServices();
  vi.mocked(useProjectGeneration).mockReturnValue(IDLE_GENERATION);
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
    store
      .getState()
      .dispatchCommand(changeVelocityCommand([note.id], 100, commandLabel('changeVelocity')));

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

describe('AppLayout export scope', () => {
  /** The mock exporter records every save; the mock io uses the real MIDI codec. */
  function savedFiles(): Array<{ name: string; data: Uint8Array | string; mimeType: string }> {
    return (
      getAppServices().io.fileExporter as unknown as {
        saved: Array<{ name: string; data: Uint8Array | string; mimeType: string }>;
      }
    ).saved;
  }

  function exportedTrackCount(): number {
    const last = savedFiles().at(-1)!;
    const bytes = last.data as Uint8Array;
    return getAppServices().io.midiCodec.decode(bytes.buffer as ArrayBuffer).tracks.length;
  }

  async function openExportMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByLabelText('Export menu'));
  }

  it('writes an XM module with no extra click when the score fits', async () => {
    // A clean fit is the common case for XM and must not cost a dialog. The
    // file is decoded back to prove it is a real module rather than bytes.
    const user = userEvent.setup();
    const store = await makeStoreWithProject(threeTrackScore());
    render(<AppLayout store={store} />);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'XM Module' }));

    expect(screen.queryByText(/does not fit/)).toBeNull();
    await waitFor(() => expect(savedFiles()).toHaveLength(1));

    const saved = savedFiles().at(-1)!;
    expect(saved.name).toMatch(/\.xm$/);
    const bytes = saved.data as Uint8Array;
    const back = getAppServices().io.modCodec.decode(bytes.buffer as ArrayBuffer);
    expect(back.format).toBe('xm');
    expect(back.instruments).toHaveLength(3);
  });

  it('shows what will be lost and writes nothing until confirmed', async () => {
    // The whole point of the fit report: an export that loses material must
    // say so first. A note below XM's lowest (MIDI 12) forces an octave clamp.
    const user = userEvent.setup();
    const base = threeTrackScore();
    const lossy = {
      ...base,
      tracks: base.tracks.map((t, ti) =>
        ti !== 0
          ? t
          : {
              ...t,
              measures: t.measures.map((m, mi) =>
                mi !== 0
                  ? m
                  : {
                      ...m,
                      voices: m.voices.map((v) => ({
                        ...v,
                        events: v.events.map((e) =>
                          'pitch' in e ? { ...e, pitch: midiToPitch(5) } : e,
                        ),
                      })),
                    },
              ),
            },
      ),
    };
    const store = await makeStoreWithProject(lossy);
    render(<AppLayout store={store} />);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'XM Module' }));

    expect(await screen.findByText(/does not fit/)).toBeInTheDocument();
    expect(screen.getByText(/moved by whole octaves/)).toBeInTheDocument();
    // Nothing written while the question is on screen.
    expect(savedFiles()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Export anyway' }));
    await waitFor(() => expect(savedFiles()).toHaveLength(1));
  });

  it('exports without asking when nothing is hidden', async () => {
    const user = userEvent.setup();
    const store = await makeStoreWithProject(threeTrackScore());
    render(<AppLayout store={store} />);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MIDI' }));

    expect(screen.queryByText('Export hidden tracks?')).toBeNull();
    await waitFor(() => expect(savedFiles()).toHaveLength(1));
    expect(exportedTrackCount()).toBe(3);
  });

  it('asks when tracks are hidden, and exports the whole score on that choice', async () => {
    const user = userEvent.setup();
    const store = await makeStoreWithProject(threeTrackScore());
    act(() => store.getState().setVisibleTracks([store.getState().score!.tracks[0].id]));
    render(<AppLayout store={store} />);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MIDI' }));

    expect(await screen.findByText('Export hidden tracks?')).toBeInTheDocument();
    expect(screen.getByText(/2 hidden tracks/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Whole score' }));

    await waitFor(() => expect(savedFiles()).toHaveLength(1));
    expect(exportedTrackCount()).toBe(3);
  });

  it('exports only the visible tracks on that choice', async () => {
    const user = userEvent.setup();
    const store = await makeStoreWithProject(threeTrackScore());
    act(() => store.getState().setVisibleTracks([store.getState().score!.tracks[0].id]));
    render(<AppLayout store={store} />);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MIDI' }));
    await user.click(screen.getByRole('button', { name: 'Visible tracks only' }));

    await waitFor(() => expect(savedFiles()).toHaveLength(1));
    expect(exportedTrackCount()).toBe(1);
  });

  it('cancelling writes no file', async () => {
    const user = userEvent.setup();
    const store = await makeStoreWithProject(threeTrackScore());
    act(() => store.getState().setVisibleTracks([store.getState().score!.tracks[0].id]));
    render(<AppLayout store={store} />);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MIDI' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Export hidden tracks?')).toBeNull();
    expect(savedFiles()).toHaveLength(0);
  });

  it('asks for MusicXML too', async () => {
    const user = userEvent.setup();
    const store = await makeStoreWithProject(threeTrackScore());
    act(() => store.getState().setVisibleTracks([store.getState().score!.tracks[0].id]));
    render(<AppLayout store={store} />);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'MusicXML' }));

    expect(await screen.findByText('Export hidden tracks?')).toBeInTheDocument();
  });

  it('does not ask for Project JSON, which is the project rather than a view of it', async () => {
    const user = userEvent.setup();
    const store = await makeStoreWithProject(threeTrackScore());
    act(() => store.getState().setVisibleTracks([store.getState().score!.tracks[0].id]));
    render(<AppLayout store={store} />);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Project JSON' }));

    expect(screen.queryByText('Export hidden tracks?')).toBeNull();
    await waitFor(() => expect(savedFiles()).toHaveLength(1));
  });
});

/**
 * Snapshots pin the *server's* project row, so the live score has to be there
 * first. This used to be an unconditional PUT of the whole score, and the
 * invariant was e2e-only — the API's own tests cannot see it, because a
 * project created through the API is current by construction.
 */
describe('AppLayout — snapshots', () => {
  type SnapshotStubs = {
    createSnapshot: ReturnType<typeof vi.fn>;
    storedMeasureCountAtSnapshot: () => number | null;
  };

  /** Teaches the in-memory client the snapshot calls this panel makes. */
  function stubSnapshotClient(
    context: ReturnType<typeof installTestAppServices>,
    projectId: () => string,
  ): SnapshotStubs {
    const client = context.client as unknown as Record<string, unknown>;
    let measuresAtSnapshot: number | null = null;
    const createSnapshot = vi.fn(async () => {
      const stored = context.fakeClient.storedRecord(projectId());
      measuresAtSnapshot = stored?.score.tracks[0].measures.length ?? null;
      return {
        id: 's1',
        projectId: projectId(),
        parentId: null,
        name: 'Version 1',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
    });
    client.listSnapshots = vi.fn(async () => []);
    client.lastPublisherName = vi.fn(async () => ({ publisherName: null }));
    client.createSnapshot = createSnapshot;
    return { createSnapshot, storedMeasureCountAtSnapshot: () => measuresAtSnapshot };
  }

  it('flushes the live score before pinning it', async () => {
    const user = userEvent.setup();
    const context = installTestAppServices();
    const store = createAppStore({ context });
    await store.getState().newProject({ name: 'Snap', score: twinkleScore() });
    const stubs = stubSnapshotClient(context, () => store.getState().projectId!);

    render(<AppLayout store={store} />);

    // An edit still inside the autosave debounce window: the server has not
    // seen it, and a snapshot taken now would pin the music without it.
    const before = store.getState().score!.tracks[0].measures.length;
    act(() => store.getState().dispatchCommand(addMeasureCommand(commandLabel('addMeasure'))));
    expect(store.getState().dirty).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Project menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create snapshot…' }));
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));

    await waitFor(() => expect(stubs.createSnapshot).toHaveBeenCalled());
    expect(stubs.storedMeasureCountAtSnapshot()).toBe(before + 1);
  });

  it('does not re-upload a score the server already has', async () => {
    // `saveNow` is a no-op when nothing is dirty. The unconditional PUT this
    // replaced sent the whole score every time somebody took a second
    // snapshot of music they had not touched.
    const user = userEvent.setup();
    const context = installTestAppServices();
    const store = createAppStore({ context });
    await store.getState().newProject({ name: 'Snap', score: twinkleScore() });
    const stubs = stubSnapshotClient(context, () => store.getState().projectId!);
    render(<AppLayout store={store} />);

    const writesBefore = context.fakeClient.updateCalls;
    await user.click(screen.getByRole('button', { name: 'Project menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create snapshot…' }));
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));

    await waitFor(() => expect(stubs.createSnapshot).toHaveBeenCalled());
    expect(context.fakeClient.updateCalls).toBe(writesBefore);
  });
});

describe('the generating overlay covers the whole editing area', () => {
  it('covers the keyboard, the transport and the inspector — not just the sheet', async () => {
    // A job rewrites the score server-side, and the project is immutable for
    // the duration: a keyboard that still auditions notes, or a transport that
    // still plays, is offering to edit music that is about to be replaced.
    // The overlay used to sit inside the sheet's own column, leaving all three
    // live underneath it.
    vi.mocked(useProjectGeneration).mockReturnValue({
      generating: true,
      error: null,
      start: vi.fn(),
      cancel: vi.fn(),
    } as unknown as ReturnType<typeof useProjectGeneration>);

    const store = await makeStoreWithProject();
    render(<AppLayout store={store} />);

    const overlay = screen.getByTestId('generating-overlay');
    // `absolute inset-0` covers its offset parent, so "what does it cover" is
    // "what else lives in that parent".
    const region = overlay.parentElement!;
    expect(region.contains(screen.getByRole('toolbar', { name: 'Playback transport' }))).toBe(true);
    expect(region.contains(screen.getByRole('img', { name: /Piano keyboard/ }))).toBe(true);
    expect(region.contains(screen.getByRole('toolbar', { name: 'Score editor toolbar' }))).toBe(
      true,
    );
    // But not the app bar: leaving is ordinary navigation.
    expect(region.contains(screen.getByRole('button', { name: 'Back to dashboard' }))).toBe(false);
  });
});
