/**
 * The playback hooks render when what they show changes, not when the engine
 * reports.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { playbackController } from '@sudobility/music_lib';
import { usePlaybackReadout } from './usePlayback';

vi.mock('@sudobility/music_lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sudobility/music_lib')>();
  return { ...actual, playbackController: { bus: new actual.PlaybackBus() } };
});

describe('usePlaybackReadout', () => {
  it('renders once per change of text, however many reports arrive', () => {
    const beat = (tick: number) => String(Math.floor(tick / 480) + 1);
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return usePlaybackReadout(beat);
    });
    const settled = renders;

    // Thirty reports inside one beat, as the engine sends in a second.
    act(() => {
      for (let tick = 0; tick < 480; tick += 16) playbackController.bus.publishPosition(tick);
    });
    expect(renders).toBe(settled);
    expect(result.current).toBe('1');

    act(() => playbackController.bus.publishPosition(480));
    expect(renders).toBe(settled + 1);
    expect(result.current).toBe('2');
  });
});
