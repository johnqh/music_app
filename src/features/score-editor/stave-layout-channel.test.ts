import { describe, expect, it, vi } from 'vitest';
import { createStaveLayoutChannel } from '@/features/score-editor/stave-layout-channel';

const rects = [{ trackId: 't0', top: 10, height: 100 }];

describe('createStaveLayoutChannel', () => {
  it('starts empty', () => {
    expect(createStaveLayoutChannel().current()).toEqual([]);
  });

  it('delivers a publish to every subscriber', () => {
    const channel = createStaveLayoutChannel();
    const a = vi.fn();
    const b = vi.fn();
    channel.subscribe(a);
    channel.subscribe(b);

    channel.publish(rects);

    expect(a).toHaveBeenLastCalledWith(rects);
    expect(b).toHaveBeenLastCalledWith(rects);
  });

  it('fires immediately on subscribe with the latest value', () => {
    // Otherwise a consumer mounting after the producer's first publish would
    // stay blank until the next scroll.
    const channel = createStaveLayoutChannel();
    channel.publish(rects);
    const listener = vi.fn();

    channel.subscribe(listener);

    expect(listener).toHaveBeenCalledWith(rects);
  });

  it('stops delivering after unsubscribe', () => {
    const channel = createStaveLayoutChannel();
    const listener = vi.fn();
    const unsubscribe = channel.subscribe(listener);
    listener.mockClear();

    unsubscribe();
    channel.publish(rects);

    expect(listener).not.toHaveBeenCalled();
  });

  it('remembers the latest publish', () => {
    const channel = createStaveLayoutChannel();
    channel.publish(rects);
    channel.publish([]);
    expect(channel.current()).toEqual([]);
  });
});
