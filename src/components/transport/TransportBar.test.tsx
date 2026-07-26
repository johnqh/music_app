import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { twinkleScore } from '@sudobility/music_lib';
import type { PlaybackStoreApi } from '@sudobility/music_lib';

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

import { playbackController } from '@sudobility/music_lib';
import { TransportBar } from '@/components/transport/TransportBar';

function makeStore(withScore = true): PlaybackStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  if (withScore) store.getState().setScore(twinkleScore());
  return store;
}

afterEach(async () => {
  vi.clearAllMocks();
});

function renderBar(store: PlaybackStoreApi) {
  render(<TransportBar store={store} />);
}

describe('TransportBar: transport buttons', () => {
  it('play button calls playbackController.togglePlay()', async () => {
    const store = makeStore();
    renderBar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(playbackController.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('shows Pause when playback-slice state is playing', () => {
    const store = makeStore();
    store.getState().setPlaybackState('playing');
    renderBar(store);

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('stop button calls playbackController.stop() and stopPreview() (so a candidate preview is cleaned up too)', async () => {
    const store = makeStore();
    renderBar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(playbackController.stop).toHaveBeenCalledTimes(1);
    expect(playbackController.stopPreview).toHaveBeenCalledTimes(1);
  });

  it('go to start / previous / next measure buttons delegate to the controller', async () => {
    const store = makeStore();
    renderBar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Go to start' }));
    await user.click(screen.getByRole('button', { name: 'Previous measure' }));
    await user.click(screen.getByRole('button', { name: 'Next measure' }));

    expect(playbackController.goToStart).toHaveBeenCalledTimes(1);
    expect(playbackController.previousMeasure).toHaveBeenCalledTimes(1);
    expect(playbackController.nextMeasure).toHaveBeenCalledTimes(1);
  });

  it('disables every transport button when no score is loaded', () => {
    const store = makeStore(false);
    renderBar(store);

    for (const name of [
      'Go to start',
      'Previous measure',
      'Play',
      'Stop',
      'Next measure',
      'Toggle loop',
      'Toggle metronome',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });
});

describe('TransportBar: loop and metronome toggles', () => {
  it('loop toggle calls playbackController.toggleLoop()', async () => {
    const store = makeStore();
    renderBar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle loop' }));

    expect(playbackController.toggleLoop).toHaveBeenCalledTimes(1);
  });

  it('loop toggle reflects loopRange presence', () => {
    const store = makeStore();
    store.getState().setLoopRange({ startTick: 0, endTick: 480, trackIds: [] });
    renderBar(store);

    expect(screen.getByRole('button', { name: 'Toggle loop' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('metronome toggle calls playbackController.setMetronome() with the opposite of the current value', async () => {
    const store = makeStore();
    renderBar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle metronome' }));

    expect(playbackController.setMetronome).toHaveBeenCalledWith(true);
  });
});

describe('TransportBar: position display', () => {
  it('shows measure.beat for the current position', () => {
    const store = makeStore();
    const score = store.getState().score!;
    store.getState().setPositionTick(score.tracks[0].measures[1].startTick);
    renderBar(store);

    expect(screen.getByLabelText('Current measure and beat')).toHaveTextContent('2.1');
  });

  it('shows a placeholder with no score loaded', () => {
    const store = makeStore(false);
    renderBar(store);

    expect(screen.getByLabelText('Current measure and beat')).toHaveTextContent('-.-');
  });
});

describe('TransportBar: tempo edit', () => {
  it('clicking the tempo display opens an editable field pre-filled with the current bpm', async () => {
    const store = makeStore();
    renderBar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Tempo (BPM)' }));

    const input = screen.getByRole('spinbutton', { name: 'Tempo (BPM)' });
    expect(input).toHaveValue(120);
  });

  it('committing a new tempo (Enter) dispatches a score-level tempo change', async () => {
    const store = makeStore();
    renderBar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Tempo (BPM)' }));
    const input = screen.getByRole('spinbutton', { name: 'Tempo (BPM)' });
    await user.clear(input);
    await user.type(input, '140{Enter}');

    expect(store.getState().score!.tempoMap[0].bpm).toBe(140);
    expect(store.getState().canUndo).toBe(true);
  });

  it('Escape cancels the edit without dispatching a command', async () => {
    const store = makeStore();
    renderBar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Tempo (BPM)' }));
    const input = screen.getByRole('spinbutton', { name: 'Tempo (BPM)' });
    await user.clear(input);
    await user.type(input, '999{Escape}');

    expect(store.getState().score!.tempoMap[0].bpm).toBe(120);
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('TransportBar: speed select', () => {
  it('selecting a speed calls playbackController.setTempoMultiplier()', async () => {
    const store = makeStore();
    renderBar(store);
    const user = userEvent.setup();

    // Library sweep 1: the native <select> becomes @sudobility/components'
    // Radix-backed Select -- its trigger has role="combobox" (not a real
    // <select>), so `selectOptions` no longer applies; open it and click
    // the resulting role="option" instead.
    await user.click(screen.getByRole('combobox', { name: 'Playback speed' }));
    await user.click(await screen.findByRole('option', { name: '2x' }));

    expect(playbackController.setTempoMultiplier).toHaveBeenCalledWith(2);
  });
});

describe('TransportBar: master volume', () => {
  it('changing the volume slider calls playbackController.setMasterVolume()', () => {
    const store = makeStore();
    renderBar(store);

    const slider = screen.getByRole('slider', { name: 'Master volume' });
    fireEvent.change(slider, { target: { value: '0.3' } });

    expect(playbackController.setMasterVolume).toHaveBeenCalledWith(0.3);
  });
});

describe('TransportBar: timeline scrubber', () => {
  it('changing the scrubber calls playbackController.seek() with the tick value', () => {
    const store = makeStore();
    renderBar(store);

    const scrubber = screen.getByLabelText('Playback position');
    fireEvent.change(scrubber, { target: { value: '960' } });

    expect(playbackController.seek).toHaveBeenCalledWith(960);
  });

  it('is disabled with no score loaded', () => {
    const store = makeStore(false);
    renderBar(store);

    expect(screen.getByLabelText('Playback position')).toBeDisabled();
  });
});

describe('TransportBar: accessibility', () => {
  it('every interactive control has an accessible name', () => {
    const store = makeStore();
    renderBar(store);
    const toolbar = screen.getByRole('toolbar');
    const buttons = within(toolbar).getAllByRole('button');
    for (const button of buttons) {
      expect(button).toHaveAccessibleName();
    }
  });
});
