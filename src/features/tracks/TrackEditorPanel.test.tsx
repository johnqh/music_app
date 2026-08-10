import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  changeClefCommand,
  changeTrackPropsCommand,
  createAppStore,
  testStoreContext,
  twoTrackScore,
} from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { TrackEditorPanel } from '@/features/tracks/TrackEditorPanel';

function makeStore(): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twoTrackScore());
  return store;
}

describe('TrackEditorPanel', () => {
  it('shows the active track', () => {
    const store = makeStore();
    const score = store.getState().score!;
    act(() => store.getState().setActiveTrack(score.tracks[1].id));

    render(<TrackEditorPanel store={store} />);

    expect(screen.getByLabelText(`Track name: ${score.tracks[1].name}`)).toBeInTheDocument();
  });

  it('follows the active track when it changes', () => {
    const store = makeStore();
    const score = store.getState().score!;
    act(() => store.getState().setActiveTrack(score.tracks[0].id));
    render(<TrackEditorPanel store={store} />);
    expect(screen.getByLabelText(`Track name: ${score.tracks[0].name}`)).toBeInTheDocument();

    act(() => store.getState().setActiveTrack(score.tracks[1].id));

    expect(screen.getByLabelText(`Track name: ${score.tracks[1].name}`)).toBeInTheDocument();
  });

  it('renames the active track on blur', async () => {
    const store = makeStore();
    const score = store.getState().score!;
    render(<TrackEditorPanel store={store} />);
    const user = userEvent.setup();

    const input = screen.getByLabelText(`Track name: ${score.tracks[0].name}`);
    await user.clear(input);
    await user.type(input, 'Lead');
    await user.tab();

    expect(store.getState().score!.tracks[0].name).toBe('Lead');
  });

  it('changes the instrument, setting both fields', async () => {
    const store = makeStore();
    const score = store.getState().score!;
    render(<TrackEditorPanel store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(`Instrument: ${score.tracks[0].name}`));
    await user.click(await screen.findByRole('option', { name: /^Trumpet$/ }));

    const track = store.getState().score!.tracks[0];
    expect(track.midiProgram).toBe(56);
    expect(track.instrumentName).toBe('Trumpet');
  });

  it('offers drum kits, not instruments, for a percussion track', async () => {
    // A percussion track's `midiProgram` selects a kit. Offering the melodic
    // catalogue meant picking "Celesta" quietly switched the kit to Room —
    // program 8 is both — and picking "Jazz Guitar" did nothing at all,
    // because no kit sits at that address.
    const store = makeStore();
    const score = store.getState().score!;
    act(() =>
      store.getState().dispatchCommand(changeClefCommand(score.tracks[0].id, 'percussion')),
    );
    render(<TrackEditorPanel store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(`Drum kit: ${score.tracks[0].name}`));
    expect(screen.getAllByRole('option')).toHaveLength(8);
    await user.click(await screen.findByRole('option', { name: /^TR-808 Kit$/ }));

    const track = store.getState().score!.tracks[0];
    expect(track.midiProgram).toBe(25);
    expect(track.instrumentName).toBe('TR-808 Kit');
  });

  it('opens the instrument list in a modal, grouped by family', async () => {
    // 128 options is why this is a modal and not a dropdown: a dropdown is
    // bounded by the space around its trigger, and the family headings are
    // what make the list navigable once it is that long.
    const store = makeStore();
    const score = store.getState().score!;
    render(<TrackEditorPanel store={store} />);
    const user = userEvent.setup();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(`Instrument: ${score.tracks[0].name}`));

    expect(await screen.findByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(128);
    expect(screen.getByText('Brass')).toBeInTheDocument();
  });

  it('cancels the instrument modal without changing the track', async () => {
    const store = makeStore();
    const score = store.getState().score!;
    const before = score.tracks[0].midiProgram;
    render(<TrackEditorPanel store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(`Instrument: ${score.tracks[0].name}`));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(store.getState().score!.tracks[0].midiProgram).toBe(before);
  });

  it('changes the clef', async () => {
    const store = makeStore();
    const score = store.getState().score!;
    render(<TrackEditorPanel store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(`Clef: ${score.tracks[0].clef}`));
    await user.click(await screen.findByRole('option', { name: 'alto' }));

    expect(store.getState().score!.tracks[0].clef).toBe('alto');
  });

  it('toggles mute and solo', async () => {
    const store = makeStore();
    const score = store.getState().score!;
    render(<TrackEditorPanel store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(`Mute: ${score.tracks[0].name}`));
    expect(store.getState().score!.tracks[0].muted).toBe(true);

    await user.click(screen.getByLabelText(`Solo: ${score.tracks[0].name}`));
    expect(store.getState().score!.tracks[0].solo).toBe(true);
  });

  it('offers no way to add a track', () => {
    // Adding lives on the editor toolbar now — one control, not two that
    // differed only by the case of their label.
    const store = makeStore();
    render(<TrackEditorPanel store={store} />);
    expect(screen.queryByRole('button', { name: /add track/i })).toBeNull();
  });

  it('deletes the active track after confirming', async () => {
    const store = makeStore();
    const score = store.getState().score!;
    act(() => store.getState().setActiveTrack(score.tracks[1].id));
    render(<TrackEditorPanel store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Delete track'));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(store.getState().score!.tracks.map((t) => t.id)).not.toContain(score.tracks[1].id);
  });

  it('shows mute state as an icon, not as the letter M', async () => {
    // "M" and "S" only read to someone who already knows the convention, and
    // this panel is where a newcomer meets these controls.
    const store = makeStore();
    const score = store.getState().score!;
    render(<TrackEditorPanel store={store} />);
    const user = userEvent.setup();

    const mute = screen.getByLabelText(`Mute: ${score.tracks[0].name}`);
    expect(mute.textContent).toBe('');
    expect(mute.querySelector('svg')).not.toBeNull();
    expect(mute).toHaveAttribute('aria-pressed', 'false');

    await user.click(mute);
    expect(screen.getByLabelText(`Mute: ${score.tracks[0].name}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('pans from the centre, since pan is bipolar', async () => {
    // A left-anchored fill made a centred pan look like a half-open volume.
    const store = makeStore();
    const { container } = render(<TrackEditorPanel store={store} />);

    const fills = Array.from(container.querySelectorAll<HTMLElement>('div[style*="width"]'));
    const panFill = fills[fills.length - 1];
    expect(panFill.style.width).toBe('0%');
  });

  it('every edit is undoable, like any score change', async () => {
    const store = makeStore();
    const score = store.getState().score!;
    render(<TrackEditorPanel store={store} />);

    await userEvent.setup().click(screen.getByLabelText(`Mute: ${score.tracks[0].name}`));
    act(() => store.getState().undo());

    expect(store.getState().score!.tracks[0].muted).toBe(false);
  });

  it('renders an empty state with no score rather than collapsing', () => {
    const store = createAppStore({ context: testStoreContext() });
    render(<TrackEditorPanel store={store} />);
    expect(screen.getByText('No score loaded.')).toBeInTheDocument();
  });

  it('reflects an instrument change made elsewhere', () => {
    const store = makeStore();
    const score = store.getState().score!;
    render(<TrackEditorPanel store={store} />);

    act(() =>
      store.getState().dispatchCommand(
        changeTrackPropsCommand(score.tracks[0].id, {
          midiProgram: 40,
          instrumentName: 'Violin',
        }),
      ),
    );

    expect(screen.getByLabelText(`Instrument: ${score.tracks[0].name}`)).toHaveTextContent(
      'Violin',
    );
  });
});
