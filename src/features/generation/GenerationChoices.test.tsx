import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GenerationRecord } from '@sudobility/music_types';
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
    expect(onGenerateAgain).toHaveBeenCalledWith({ groove: 'songo' });
  });
});
