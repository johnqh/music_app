/**
 * These assert class names, which is usually a smell — but the two bugs this
 * file exists to prevent are both invisible to jsdom, which computes no
 * layout and resolves no CSS variables:
 *
 * - the groove painted transparent, because `bg-theme-border` compiles to
 *   `var(--color-border)` and the design system injects `--border` instead;
 * - the two rows drifted apart, because each sized its own label column.
 *
 * The rendered result was verified in a real browser (volume and pan grooves
 * both at x 80–252, groove `rgb(204,204,204)`); this keeps it from regressing.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PanSlider, VolumeSlider } from '@/features/tracks/mixer-controls';
import { panReadout } from '@sudobility/music_types';

/** The unfilled bed: the first painted div, which every fill draws over. */
function grooveOf(container: HTMLElement): HTMLElement {
  const groove = container.querySelector('div[aria-hidden][class*="absolute"]');
  if (!groove) throw new Error('no groove painted');
  return groove as HTMLElement;
}

describe('mixer controls', () => {
  it('paints the groove with a token the theme actually defines', () => {
    // `--color-border` is never injected; `--border` is. A `theme-` class here
    // resolves to nothing and the control loses its track entirely.
    const { container } = render(
      <VolumeSlider label="Track volume" rowLabel="Volume" value={0.4} onChange={() => {}} />,
    );
    const groove = grooveOf(container);
    expect(groove.className).toContain('bg-border');
    expect(groove.className).not.toContain('theme-');
  });

  it('gives pan a groove too, not just a thumb', () => {
    const { container } = render(
      <PanSlider label="Track pan" rowLabel="Pan" value={0} onChange={() => {}} />,
    );
    expect(grooveOf(container).className).not.toContain('theme-');
    expect(grooveOf(container).className).toMatch(/bg-\S+/);
  });

  it('draws pan as a channel, not as a level', () => {
    // Square ends and a darker bed, because the two rows sit directly above
    // one another at the same size and mean opposite things.
    const pan = render(
      <PanSlider label="Track pan" rowLabel="Pan" value={0} onChange={() => {}} />,
    );
    const volume = render(
      <VolumeSlider label="Track volume" rowLabel="Volume" value={0.4} onChange={() => {}} />,
    );

    const panGroove = grooveOf(pan.container).className;
    expect(panGroove).not.toContain('rounded-full');
    expect(grooveOf(volume.container).className).toContain('rounded-full');
    expect(panGroove).not.toBe(grooveOf(volume.container).className);
  });

  it('gives pan a rectangular knob, where volume has a round thumb', () => {
    const pan = render(
      <PanSlider label="Track pan" rowLabel="Pan" value={0} onChange={() => {}} />,
    );
    const knob = pan.container.querySelector('input[type=range]')!.className;
    expect(knob).toContain('[&::-webkit-slider-thumb]:rounded-none');
    expect(knob).not.toContain('[&::-webkit-slider-thumb]:rounded-full');
  });

  it('lays both rows out identically, label column included', () => {
    // The label column is fixed rather than sized to its text: "Volume" is a
    // longer word than "Pan", and sizing to content put the two grooves at
    // different x with different widths.
    const volume = render(
      <VolumeSlider label="Track volume" rowLabel="Volume" value={0.4} onChange={() => {}} />,
    );
    const pan = render(
      <PanSlider label="Track pan" rowLabel="Pan" value={0} onChange={() => {}} />,
    );

    const labelClass = (r: ReturnType<typeof render>) =>
      r.container.querySelector('span')?.className ?? '';
    expect(labelClass(volume)).toBe(labelClass(pan));
    // Same class is not enough — both sizing to their own text is also "the
    // same". The column has to be a stated width for the grooves to line up.
    expect(labelClass(volume)).toMatch(/\bw-\d/);
  });

  it('says how loud, so the range is legible without reading the bar', () => {
    render(
      <VolumeSlider label="Track volume" rowLabel="Volume" value={0.45} onChange={() => {}} />,
    );
    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  it('reads pan as a side and a distance', () => {
    // "0.4" says neither which side nor the convention; at centre there is no
    // side to name at all.
    expect(panReadout(0)).toBe('C');
    expect(panReadout(-0.4)).toBe('L40');
    expect(panReadout(0.25)).toBe('R25');
  });

  it('fills pan out of the centre, not up from the left', () => {
    const { container } = render(
      <PanSlider label="Track pan" rowLabel="Pan" value={-0.4} onChange={() => {}} />,
    );
    const fill = container.querySelector('div[class*="bg-primary"]') as HTMLElement;
    // 20% wide, ending at the midpoint: left 30%, not left 0%.
    expect(fill.style.left).toBe('30%');
    expect(fill.style.width).toBe('20%');
  });

  it('centres the pan when reset is pressed', () => {
    const onReset = vi.fn();
    render(
      <PanSlider
        label="Track pan"
        rowLabel="Pan"
        value={-0.4}
        onChange={() => {}}
        onReset={onReset}
        resetLabel="Center pan"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Center pan' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('offers no reset when the pan is already centred', () => {
    // A live-looking button that does nothing is worse than a disabled one.
    render(
      <PanSlider
        label="Track pan"
        rowLabel="Pan"
        value={0}
        onChange={() => {}}
        onReset={() => {}}
        resetLabel="Center pan"
      />,
    );
    expect(screen.getByRole('button', { name: 'Center pan' })).toBeDisabled();
  });

  it('reserves the action column on both rows, so the grooves still line up', () => {
    const volume = render(
      <VolumeSlider label="Track volume" rowLabel="Volume" value={0.4} onChange={() => {}} />,
    );
    const pan = render(
      <PanSlider
        label="Track pan"
        rowLabel="Pan"
        value={-0.4}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    const lastChildClass = (r: ReturnType<typeof render>) =>
      (r.container.firstElementChild!.lastElementChild as HTMLElement).className;

    expect(lastChildClass(volume)).toBe(lastChildClass(pan));
  });
});
