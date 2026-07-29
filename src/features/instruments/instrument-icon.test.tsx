import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GM_INSTRUMENTS, gmFamilyOf } from '@sudobility/music_lib';
import { InstrumentIcon, instrumentEmoji } from '@/features/instruments/instrument-icon';

describe('instrumentEmoji', () => {
  it('gives every one of the 128 programs a non-empty glyph', () => {
    for (const instrument of GM_INSTRUMENTS) {
      expect(instrumentEmoji(instrument.program).length).toBeGreaterThan(0);
    }
  });

  it('uses the hand-picked glyph for common instruments', () => {
    expect(instrumentEmoji(0)).toBe('🎹'); // Acoustic Grand Piano
    expect(instrumentEmoji(24)).toBe('🎸'); // Acoustic Guitar (nylon)
    expect(instrumentEmoji(40)).toBe('🎻'); // Violin
    expect(instrumentEmoji(56)).toBe('🎺'); // Trumpet
    expect(instrumentEmoji(65)).toBe('🎷'); // Alto Sax
    expect(instrumentEmoji(73)).toBe('🪈'); // Flute
  });

  it('falls back to the family glyph for an instrument with no hand-picked one', () => {
    // Every member of a family shares a glyph unless hand-picked, so two
    // un-picked members of the same family must agree.
    const sameFamily = GM_INSTRUMENTS.filter((i) => i.family === 'synth-effects');
    const glyphs = new Set(sameFamily.map((i) => instrumentEmoji(i.program)));
    expect(glyphs.size).toBe(1);
  });

  it('falls back rather than returning empty for a program outside the range', () => {
    expect(instrumentEmoji(-1).length).toBeGreaterThan(0);
    expect(instrumentEmoji(999).length).toBeGreaterThan(0);
  });

  it('gives every family a glyph', () => {
    const families = new Set(GM_INSTRUMENTS.map((i) => gmFamilyOf(i.program)));
    for (const family of families) {
      const member = GM_INSTRUMENTS.find((i) => i.family === family)!;
      expect(instrumentEmoji(member.program).length).toBeGreaterThan(0);
    }
  });
});

describe('InstrumentIcon', () => {
  it('renders the glyph', () => {
    const { container } = render(<InstrumentIcon program={40} />);
    expect(container.textContent).toBe('🎻');
  });

  it('is hidden from assistive tech, since the name is always beside it', () => {
    const { container } = render(<InstrumentIcon program={40} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes through a className', () => {
    const { container } = render(<InstrumentIcon program={40} className="text-lg" />);
    expect(container.firstElementChild).toHaveClass('text-lg');
  });
});
