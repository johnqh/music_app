/**
 * Simulates a real pointer-drag interaction on a native `<input
 * type="range">` in jsdom (used by `TrackPanel.test.tsx`/
 * `InspectorPanel.test.tsx` to prove volume/pan sliders dispatch their
 * command once on release, not once per drag tick).
 *
 * Re-skinned for T12 batch 3's Tailwind/native-`<input>` sliders: the MUI
 * `.MuiSlider-root` pointer-tracking dance (and the `getBoundingClientRect`
 * stub it needed to turn pixel positions into a value) is gone. The
 * volume/pan inputs now own their draft/commit split directly -- `onChange`
 * updates local draft state on every tick, and the real command is
 * dispatched from `onPointerUp`/`onKeyUp`. So this fires `fireEvent.change`
 * (draft ticks) for every intermediate position, then a single
 * `fireEvent.pointerUp` (the commit) on the same element -- no ancestor
 * lookup or rect stub needed, since the input reads its own `min`/`max`/
 * `step` to turn each `xs` position into a value.
 */
import { fireEvent } from '@testing-library/react';

/** Assumed track width (px) the `xs` positions are relative to -- an arbitrary but fixed scale, not tied to any real layout since jsdom does no layout at all. */
const TRACK_WIDTH = 200;

/**
 * `input` is the slider's accessible `<input type="range">` (e.g. from
 * `screen.getByRole('slider', {name: ...})`). Drags from `xs[0]` to
 * `xs[xs.length - 1]` (positions against the assumed 200px-wide track),
 * with every position in between as an intermediate draft tick, then
 * releases (commits) at the final position.
 */
export function dragSlider(input: HTMLElement, xs: number[]): void {
  if (xs.length < 2) throw new Error('dragSlider needs at least a start and end position.');
  const el = input as HTMLInputElement;
  const min = Number(el.min);
  const max = Number(el.max);
  const step = Number(el.step) || 1;

  const valueAt = (x: number): string => {
    const clamped = Math.min(Math.max(x, 0), TRACK_WIDTH);
    const raw = min + (clamped / TRACK_WIDTH) * (max - min);
    const stepped = Math.round(raw / step) * step;
    return String(Math.min(max, Math.max(min, stepped)));
  };

  const pointerId = 1;
  const end = xs[xs.length - 1];

  fireEvent.pointerDown(el, { clientX: xs[0], pointerId, isPrimary: true, button: 0 });
  for (const x of xs) {
    fireEvent.change(el, { target: { value: valueAt(x) } });
  }
  fireEvent.pointerUp(el, { clientX: end, pointerId });
}
