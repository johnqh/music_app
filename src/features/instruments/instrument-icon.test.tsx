import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GM_INSTRUMENTS, gmInstrumentIcon } from '@sudobility/music_lib';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';

describe('InstrumentIcon', () => {
  it("draws every shape of the program's art", () => {
    const art = gmInstrumentIcon(40);
    const { container } = render(<InstrumentIcon program={40} />);

    expect(container.querySelectorAll('path, circle')).toHaveLength(art.shapes.length);
  });

  it('renders something for all 128 programs', () => {
    for (const instrument of GM_INSTRUMENTS) {
      const { container } = render(<InstrumentIcon program={instrument.program} />);
      expect(container.querySelectorAll('path, circle').length).toBeGreaterThan(0);
    }
  });

  it('strokes in currentColor, so it takes the colour of the text beside it', () => {
    // The whole reason these are line art rather than emoji: an emoji keeps its
    // own colours and stayed bright beside a dimmed inactive track name.
    const { container } = render(<InstrumentIcon program={40} />);

    const svg = container.firstElementChild!;
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('fill', 'none');
  });

  it('is hidden from assistive tech, since the name is always beside it', () => {
    const { container } = render(<InstrumentIcon program={40} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes through a className, which is how it gets its size', () => {
    const { container } = render(<InstrumentIcon program={40} className="size-4" />);
    expect(container.firstElementChild).toHaveClass('size-4');
  });
});
