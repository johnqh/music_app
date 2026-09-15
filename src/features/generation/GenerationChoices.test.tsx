import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GenerationRecord } from '@sudobility/music_types';
import { regenerateWithLocks } from '@sudobility/music_lib';
import { GenerationChoices } from './GenerationChoices';

afterEach(cleanup);

const record: GenerationRecord = {
  request: { prompt: 'a salsa', durationMeasures: 48, tracks: [] },
  choices: {
    formShape: 'standard',
    cycle: 'i - V, a two-bar montuno repeated',
    hook: 'it opens with a step down',
    groove: 'songo',
    arcEntry: 'the chords open alone',
    arcIntensity: 'a slow burn',
    moment: 'a half-time bridge',
    carrier: 1,
    carrierName: 'Trombone',
    lyric: null,
  },
};

describe('GenerationChoices', () => {
  it('shows the choices by name and skips the ones the piece did not have', () => {
    render(<GenerationChoices record={record} generating={false} onGenerateAgain={() => {}} />);
    expect(screen.getByText('songo')).toBeTruthy();
    expect(screen.getByText('Trombone')).toBeTruthy();
    // No lyric was written, so there is no lyric row to lock.
    expect(screen.queryByLabelText(/lyric/i)).toBeNull();
  });

  /*
    The point of the panel: a lock that did not reach the request would look
    exactly like the ordinary variety the user was trying to escape.
  */
  it('generates again keeping exactly the locked choices', () => {
    const onGenerateAgain = vi.fn();
    render(
      <GenerationChoices record={record} generating={false} onGenerateAgain={onGenerateAgain} />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // groove
    fireEvent.click(screen.getByRole('button', { name: /keeping 1/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /generate again/i }).at(-1)!);
    expect(onGenerateAgain).toHaveBeenCalledWith(['groove']);
    // And those keys, through the shared builder, pin exactly that choice.
    expect(regenerateWithLocks(record, onGenerateAgain.mock.calls[0]![0]).choices).toEqual({
      groove: 'songo',
    });
  });
});

describe('GenerationChoices: the credit quote', () => {
  it('quotes generating again at bars times tracks', () => {
    const withTracks: GenerationRecord = {
      ...record,
      request: {
        ...record.request,
        tracks: [
          { name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' },
          { name: 'Bass', instrumentName: 'Bass', midiProgram: 32, clef: 'bass' },
        ],
      },
    };
    render(<GenerationChoices record={withTracks} generating={false} onGenerateAgain={() => {}} />);
    expect(screen.getByText('This will use about 96 credits.')).toBeTruthy();
  });
});
