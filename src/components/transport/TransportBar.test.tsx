import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMusicPositionSource } from '@sudobility/music_types';
import { testStoreContext } from '@sudobility/music_lib';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { twinkleScore } from '@sudobility/music_lib';
import type { PlaybackStoreApi } from '@sudobility/music_lib';

vi.mock('@sudobility/music_lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sudobility/music_lib')>();
  return {
    ...actual,
    playbackController: {
      // A real bus: the scrubber and the timecode read the playhead from it.
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

  it('stop button calls playbackController.stop()', async () => {
    const store = makeStore();
    renderBar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(playbackController.stop).toHaveBeenCalledTimes(1);
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
    getMusicPositionSource().moveTo(score.tracks[0].measures[1].startTick);
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

  /*
    Seeking is a round trip — the engine reseeks its queue, silences what was
    sounding, and reports back — and the bar used to paint only what came home,
    so the filled part trailed the thumb while dragging. Here nothing reports
    back at all (the controller is a stub), which is the sharpest version of
    the same question: the control must still show where it was dragged to.
  */
  it('paints where the drag put it without waiting for the transport', () => {
    const store = makeStore();
    renderBar(store);

    const scrubber = screen.getByLabelText('Playback position') as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: '960' } });

    expect(scrubber.value).toBe('960');
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

describe('TransportBar: timecode', () => {
  it('shows score-time position and total from the tempo map (twinkle: 120bpm, 8 measures = 16s)', () => {
    const store = makeStore();
    // The timecode reads the playhead off the bus, which is where the engine
    // reports it — the store's caret is a different value now.
    act(() => playbackController.bus.publishPosition(1920)); // one 4/4 measure at 120bpm = 2s
    renderBar(store);
    expect(screen.getByTestId('playback-timecode').textContent).toBe('0:02.0 / 0:16.0');
  });

  it('shows zeros with no score loaded', () => {
    renderBar(makeStore(false));
    expect(screen.getByTestId('playback-timecode').textContent).toBe('0:00.0 / 0:00.0');
  });
});

describe('TransportBar: synth loading', () => {
  it('says nothing while the engine is idle or ready', () => {
    const store = makeStore();
    render(<TransportBar store={store} />);
    expect(screen.queryByRole('progressbar', { name: 'Preparing instruments' })).toBeNull();

    act(() => store.getState().setSynthLoad({ status: 'ready' }));
    expect(screen.queryByRole('progressbar', { name: 'Preparing instruments' })).toBeNull();
  });

  it('shows how far the download has got', () => {
    // The first press of Play has tens of megabytes to fetch before a note can
    // sound; without this the transport reads as a broken button.
    const store = makeStore();
    render(<TransportBar store={store} />);

    act(() => store.getState().setSynthLoad({ status: 'loading', fraction: 0.4 }));
    const bar = screen.getByRole('progressbar', { name: 'Preparing instruments' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText(/Preparing instruments 40%/)).toBeInTheDocument();
  });

  it('drops the percentage when there is no measurable progress', () => {
    // The synth digesting the font reports nothing until it is done, and a
    // number that sits still for five seconds is worse than no number.
    const store = makeStore();
    render(<TransportBar store={store} />);

    act(() => store.getState().setSynthLoad({ status: 'loading', fraction: null }));
    const bar = screen.getByRole('progressbar', { name: 'Preparing instruments' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('Preparing instruments')).toBeInTheDocument();
  });

  it('cannot be told to play while the instruments are still loading', () => {
    // Nothing can sound until the font is in, and the transport used to say
    // "playing" anyway — so the caret, which interpolates from elapsed real
    // time between position reports, ran silently through several bars and
    // then snapped back when the music actually started at the beginning.
    const store = makeStore();
    render(<TransportBar store={store} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();

    act(() => store.getState().setSynthLoad({ status: 'loading', fraction: 0.4 }));

    const button = screen.getByRole('button', { name: 'Preparing instruments' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('goes back to Play once the instruments are ready', () => {
    const store = makeStore();
    render(<TransportBar store={store} />);
    act(() => store.getState().setSynthLoad({ status: 'loading', fraction: 0.4 }));

    act(() => store.getState().setSynthLoad({ status: 'ready' }));

    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
  });

  it('leaves Play usable when the instruments failed, so the error is not a trap', () => {
    // A failed load is terminal for the font, not for the button: retrying is
    // the only thing left to try, and a disabled control offers nothing.
    const store = makeStore();
    render(<TransportBar store={store} />);

    act(() => store.getState().setSynthLoad({ status: 'failed', message: 'boom' }));

    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
  });

  it('says so when the instruments cannot be loaded at all', () => {
    const store = makeStore();
    render(<TransportBar store={store} />);

    act(() => store.getState().setSynthLoad({ status: 'failed', message: 'boom' }));
    expect(screen.getByText('Instruments failed to load')).toBeInTheDocument();
  });
});
