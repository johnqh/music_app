/**
 * Simulates a real pointer-drag interaction on an MUI `<Slider>` in jsdom
 * (used by `TrackPanel.test.tsx`/`InspectorPanel.test.tsx` to prove volume/
 * pan sliders dispatch their command once on release, not once per drag
 * tick).
 *
 * A single `fireEvent.change` on the slider's hidden native `<input
 * type="range">` is *not* a substitute for this: MUI's hidden-input change
 * handler always calls `onChange` and `onChangeCommitted` together
 * (matching keyboard-nudge semantics, where every arrow-key press commits
 * immediately) -- it can never demonstrate "many onChange ticks, one
 * commit". Only genuine `pointerdown`/`pointermove`/`pointerup` events
 * (handled by MUI's document-level drag-tracking listeners) exercise that
 * distinction, which is why this drives those directly.
 *
 * jsdom lays out nothing, so the slider root's `getBoundingClientRect` is
 * stubbed with a plausible non-zero-width rect -- without it, MUI's
 * position -> value math divides by a zero width and bails out without
 * calling either callback at all.
 */
import { fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

const STUB_RECT: DOMRect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 200,
  bottom: 20,
  width: 200,
  height: 20,
  toJSON: () => ({}),
};

/**
 * `input` is the slider's accessible hidden `<input type="range">` (e.g.
 * from `screen.getByRole('slider', {name: ...})`). Drags from `xs[0]` to
 * `xs[xs.length - 1]` (client-X pixel positions against the stubbed
 * 200px-wide track), with every position in between as an intermediate
 * `pointermove` tick.
 */
export function dragSlider(input: HTMLElement, xs: number[]): void {
  if (xs.length < 2) throw new Error('dragSlider needs at least a start and end position.');
  const root = input.closest('.MuiSlider-root');
  if (!root) throw new Error('dragSlider: no ancestor .MuiSlider-root found.');
  vi.spyOn(root as HTMLElement, 'getBoundingClientRect').mockReturnValue(STUB_RECT);

  const pointerId = 1;
  const [start, ...rest] = xs;
  const end = rest[rest.length - 1];
  const moves = rest.slice(0, -1);

  fireEvent.pointerDown(root, { clientX: start, pointerId, isPrimary: true, button: 0 });
  for (const x of moves) {
    fireEvent.pointerMove(document, { clientX: x, pointerId });
  }
  fireEvent.pointerUp(document, { clientX: end, pointerId });
}
