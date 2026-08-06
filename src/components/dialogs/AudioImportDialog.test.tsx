import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioImportDialog } from '@/components/dialogs/AudioImportDialog';

const analysis = { bpm: 118, notes: [{ midi: 69, startTick: 0, durationTicks: 480 }] };

describe('AudioImportDialog', () => {
  it('says plainly that only one line at a time works', () => {
    // Better than letting somebody import a band recording and conclude the
    // feature is broken.
    render(<AudioImportDialog open onFile={vi.fn()} onImport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/one melodic line/i)).toBeVisible();
  });

  it('cannot import before a file has been analysed', () => {
    render(<AudioImportDialog open onFile={vi.fn()} onImport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('shows the detected tempo once a file is analysed', () => {
    render(
      <AudioImportDialog
        open
        analysis={analysis}
        onFile={vi.fn()}
        onImport={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Tempo')).toHaveValue(118);
  });

  it('imports at the detected tempo when it is not touched', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(
      <AudioImportDialog
        open
        analysis={analysis}
        onFile={vi.fn()}
        onImport={onImport}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith(118);
  });

  it('lets the detected tempo be corrected', async () => {
    // Onset-based detection is weakest on loose humming, which is exactly what
    // people try first.
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(
      <AudioImportDialog
        open
        analysis={analysis}
        onFile={vi.fn()}
        onImport={onImport}
        onClose={vi.fn()}
      />,
    );
    await user.clear(screen.getByLabelText('Tempo'));
    await user.type(screen.getByLabelText('Tempo'), '90');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith(90);
  });

  it('reports the chosen file', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<AudioImportDialog open onFile={onFile} onImport={vi.fn()} onClose={vi.fn()} />);
    await user.upload(
      screen.getByLabelText('Audio file'),
      new File([new Uint8Array([1, 2, 3])], 'hum.wav', { type: 'audio/wav' }),
    );
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'hum.wav' }));
  });
});

describe('tempo correction rescales the ticks', () => {
  /**
   * The transcription is emitted against the **detected** tempo, so correcting
   * the tempo must rescale the ticks or the notes land in the wrong bars.
   * This is the arithmetic `AppLayout`'s import handler performs; pinned here
   * because getting it backwards is silent — the notes still appear, just in
   * the wrong place.
   */
  const rescale = (
    notes: Array<{ startTick: number; durationTicks: number }>,
    detected: number,
    chosen: number,
  ) => {
    const scale = detected === 0 ? 1 : chosen / detected;
    return notes.map((n) => ({
      startTick: Math.round(n.startTick * scale),
      durationTicks: Math.max(1, Math.round(n.durationTicks * scale)),
    }));
  };

  it('leaves ticks alone when the detected tempo is accepted', () => {
    expect(rescale([{ startTick: 480, durationTicks: 240 }], 120, 120)).toEqual([
      { startTick: 480, durationTicks: 240 },
    ]);
  });

  it('halves the ticks when the real tempo was half what was detected', () => {
    // Detected 120 but it was really 60: each note occupies half as many ticks
    // of the slower grid.
    expect(rescale([{ startTick: 480, durationTicks: 240 }], 120, 60)).toEqual([
      { startTick: 240, durationTicks: 120 },
    ]);
  });

  it('never rounds a note away to nothing', () => {
    expect(rescale([{ startTick: 0, durationTicks: 2 }], 200, 20)[0].durationTicks).toBe(1);
  });
});
