/**
 * A one-way channel carrying stave geometry from the notation view to the
 * track panel, deliberately outside React.
 *
 * The first version of this put the rects in `AppLayout` state. That re-rendered
 * the whole app tree — notation, keyboard, transport, and a track row holding a
 * 128-item Select — on every scroll frame, and the rows only moved once React
 * had committed, so the list visibly lagged behind the sheet it is supposed to
 * mirror. Publishing through a plain subscription instead means a scroll frame
 * costs no renders at all and the consumer can position rows in the same frame.
 *
 * Same reasoning as `PlaybackCaret`: geometry that changes at frame rate does
 * not belong in component state.
 */
import type { StaveRect } from '@/features/score-editor/stave-layout';

export type StaveLayoutListener = (rects: readonly StaveRect[]) => void;

export type StaveLayoutChannel = {
  publish(rects: readonly StaveRect[]): void;
  /** Returns an unsubscribe function. The listener fires immediately with the latest value. */
  subscribe(listener: StaveLayoutListener): () => void;
  /** The most recent publish, for a consumer that mounts after the producer. */
  current(): readonly StaveRect[];
};

export function createStaveLayoutChannel(): StaveLayoutChannel {
  let rects: readonly StaveRect[] = [];
  const listeners = new Set<StaveLayoutListener>();

  return {
    publish(next) {
      rects = next;
      for (const listener of listeners) listener(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      // Immediately, so a late subscriber isn't blank until the next scroll.
      listener(rects);
      return () => {
        listeners.delete(listener);
      };
    },
    current() {
      return rects;
    },
  };
}
