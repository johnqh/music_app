import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GM_INSTRUMENTS, gmInstrumentIcon, gmKitIcon } from '@/app-library';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';

/** Only the two fields the art depends on. */
const violin = { clef: 'treble' as const, midiProgram: 40 };

describe('InstrumentIcon', () => {
  it("draws every shape of the program's art", () => {
    const art = gmInstrumentIcon(40);
    const { container } = render(<InstrumentIcon track={violin} />);

    expect(container.querySelectorAll('path, circle')).toHaveLength(art.shapes.length);
  });

  it('renders something for all 128 programs', () => {
    for (const instrument of GM_INSTRUMENTS) {
      const { container } = render(
        <InstrumentIcon track={{ clef: 'treble', midiProgram: instrument.program }} />,
      );
      expect(container.querySelectorAll('path, circle').length).toBeGreaterThan(0);
    }
  });

  it('draws a kit for a percussion track, not the instrument at that address', () => {
    // Program 40 is Brush as a kit address and Violin as an instrument. The
    // icon follows the track, so a drum track never gets a violin.
    const { container } = render(
      <InstrumentIcon track={{ clef: 'percussion', midiProgram: 40 }} />,
    );

    expect(container.querySelectorAll('path, circle')).toHaveLength(gmKitIcon().shapes.length);
    expect(gmKitIcon()).not.toEqual(gmInstrumentIcon(40));
  });

  it('strokes in currentColor, so it takes the colour of the text beside it', () => {
    // The whole reason these are line art rather than emoji: an emoji keeps its
    // own colours and stayed bright beside a dimmed inactive track name.
    const { container } = render(<InstrumentIcon track={violin} />);

    const svg = container.firstElementChild!;
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('fill', 'none');
  });

  it('is hidden from assistive tech, since the name is always beside it', () => {
    const { container } = render(<InstrumentIcon track={violin} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes through a className, which is how it gets its size', () => {
    const { container } = render(<InstrumentIcon track={violin} className="size-4" />);
    expect(container.firstElementChild).toHaveClass('size-4');
  });
});
