/**
 * What the instrument picker offers, and what it hands back.
 *
 * The drum kit is the interesting case: it is not a General MIDI program —
 * percussion is selected by channel, not program — so it cannot come out of
 * the program table and has to be carried by the clef instead. Getting that
 * wrong is silent: the request still generates, just as a melodic track.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  GM_FAMILIES,
  GM_KITS,
  GM_FAMILY_LABELS,
  gmInstrumentsByFamily,
} from '@sudobility/music_lib';
import { GenerateTrackDialog } from '@/components/dialogs/GenerateTrackDialog';
import { instrumentChoiceFor } from '@/features/instruments/instrument-catalog';

describe('instrumentChoiceFor', () => {
  it('gives every kit the percussion clef and its own program', () => {
    // `music_lib` maps the percussion clef to channel 10 on export and to
    // cross noteheads when it renders, so this is what makes it a drum track;
    // on that channel the program chooses which kit is played.
    for (const kit of GM_KITS) {
      expect(instrumentChoiceFor(`kit:${kit.program}`)).toEqual({
        midiProgram: kit.program,
        instrumentName: kit.name,
        clef: 'percussion',
      });
    }
  });

  it('falls back to the Standard Kit for an address no kit sits on', () => {
    expect(instrumentChoiceFor('kit:7')).toEqual({
      midiProgram: 0,
      instrumentName: 'Standard Kit',
      clef: 'percussion',
    });
  });

  it('puts the Bass family on the bass clef and everything else on treble', () => {
    expect(instrumentChoiceFor('32').clef).toBe('bass');
    expect(instrumentChoiceFor('39').clef).toBe('bass');
    expect(instrumentChoiceFor('0').clef).toBe('treble');
    expect(instrumentChoiceFor('40').clef).toBe('treble');
  });

  it('names the instrument from the GM table', () => {
    expect(instrumentChoiceFor('0').instrumentName).toBe(gmName(0));
  });
});

function gmName(program: number): string {
  return instrumentChoiceFor(String(program)).instrumentName;
}

describe('GenerateTrackDialog', () => {
  it('offers a drum kit alongside the GM families, under section headings', async () => {
    const user = userEvent.setup();
    render(
      <GenerateTrackDialog
        open
        pending={false}
        onGenerate={() => undefined}
        onClose={() => undefined}
      />,
    );

    await user.click(screen.getByLabelText('Instrument'));

    // Every kit, none of which a program list could contain.
    expect(await screen.findByRole('option', { name: 'Standard Kit' })).toBeInTheDocument();
    for (const kit of GM_KITS) {
      expect(screen.getByRole('option', { name: kit.name })).toBeInTheDocument();
    }
    // And all 128 programs, split into their standard families rather than
    // presented as one 128-long list.
    expect(screen.getByText('Drum Kits')).toBeInTheDocument();
    expect(screen.getByText(GM_FAMILY_LABELS.piano)).toBeInTheDocument();
    expect(screen.getByText(GM_FAMILY_LABELS['sound-effects'])).toBeInTheDocument();
  });
});

describe('the list as a whole', () => {
  it('offers all 128 General MIDI programs, once each', () => {
    // The point of the picker: nothing in the standard set is unreachable.
    const programs = GM_FAMILIES.flatMap((family) =>
      gmInstrumentsByFamily(family).map((instrument) => instrument.program),
    );
    expect(programs).toHaveLength(128);
    expect(new Set(programs).size).toBe(128);
    expect(Math.min(...programs)).toBe(0);
    expect(Math.max(...programs)).toBe(127);
  });

  it('covers all sixteen families and all eight kits', () => {
    expect(GM_FAMILIES).toHaveLength(16);
    expect(GM_KITS).toHaveLength(8);
  });
});
