import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioImportDialog } from '@/components/dialogs/AudioImportDialog';

const analysis = { bpm: 118, notes: [{ midi: 69, startTick: 0, durationTicks: 480 }] };

describe('AudioImportDialog', () => {
  it('says what each mode does, and what neither of them does', () => {
    // Better than letting somebody import a band recording and conclude the
    // feature is broken. Polyphony is no longer a limitation — Basic Pitch
    // hears a chord as a chord — and instrument separation is no longer one
    // either, so what is left to be honest about is that a mix heard whole
    // still arrives as one part, and that neither mode transcribes a finished
    // record faithfully.
    render(<AudioImportDialog open onFile={vi.fn()} onImport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/chords included/i)).toBeVisible();
    expect(screen.getByText(/one dense track/i)).toBeVisible();
    expect(screen.getByText(/a sketch to edit, not a copy/i)).toBeVisible();
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

  it('reports the chosen file, and shows its name once picked', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<AudioImportDialog open onFile={onFile} onImport={vi.fn()} onClose={vi.fn()} />);
    await user.upload(
      screen.getByLabelText('audio file input'),
      new File([new Uint8Array([1, 2, 3])], 'hum.wav', { type: 'audio/wav' }),
    );
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'hum.wav' }));
    expect(screen.getByLabelText('Choose audio file')).toHaveTextContent('hum.wav');
  });

  it('says it is listening while the recording is being analysed', () => {
    // Decoding an MP3 and running pitch detection takes seconds; the dialog
    // used to show nothing at all in that window, so picking a file looked
    // like it had done nothing.
    render(<AudioImportDialog open busy onFile={vi.fn()} onImport={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Listening to the recording…');
  });

  it('reports a file it could not read', () => {
    render(
      <AudioImportDialog
        open
        error="That file could not be read as audio."
        onFile={vi.fn()}
        onImport={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('could not be read as audio');
  });

  it('says so when a recording produced no pitched line', () => {
    // "Heard 0 notes" alone reads as a bug rather than as what a chord-heavy
    // or percussive recording legitimately does.
    render(
      <AudioImportDialog
        open
        analysis={{ bpm: 120, notes: [] }}
        onFile={vi.fn()}
        onImport={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nothing came through as a pitched line/)).toBeInTheDocument();
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

describe('AudioImportDialog, choosing how to import', () => {
  const base = {
    open: true,
    onFile: vi.fn(),
    onImport: vi.fn(),
    onClose: vi.fn(),
  };
  const longPending = { seconds: 718.7, excerptSeconds: 90, longerThanSec: 120 };
  const shortPending = { seconds: 30, excerptSeconds: 90, longerThanSec: 120 };

  it('offers one part or separate instruments, defaulting to one part', () => {
    // Separation is much slower and sends the recording off this machine;
    // neither should happen unless it was asked for.
    render(<AudioImportDialog {...base} pending={shortPending} onAnalyse={vi.fn()} />);
    const one = screen.getByRole('radio', { name: /one part/i });
    const split = screen.getByRole('radio', { name: /separate instrument parts/i });
    expect(one).toBeChecked();
    expect(split).not.toBeChecked();
  });

  it('asks nothing about length for a recording short enough to just take whole', () => {
    render(<AudioImportDialog {...base} pending={shortPending} onAnalyse={vi.fn()} />);
    expect(screen.queryByRole('radio', { name: /the first/i })).toBeNull();
  });

  it('asks about length for a long recording, and states how long it is', () => {
    render(<AudioImportDialog {...base} pending={longPending} onAnalyse={vi.fn()} />);
    expect(screen.getByText(/11:59 long/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /the first 1:30/i })).toBeChecked();
  });

  it('starts a single-part import of the whole of a short recording', () => {
    const onAnalyse = vi.fn();
    render(<AudioImportDialog {...base} pending={shortPending} onAnalyse={onAnalyse} />);

    fireEvent.click(screen.getByRole('button', { name: /listen to it/i }));
    expect(onAnalyse).toHaveBeenCalledWith({ separate: false, limitSec: null });
  });

  it('defaults a long recording to the excerpt, because that is the one that finishes', () => {
    const onAnalyse = vi.fn();
    render(<AudioImportDialog {...base} pending={longPending} onAnalyse={onAnalyse} />);

    fireEvent.click(screen.getByRole('button', { name: /listen to it/i }));
    expect(onAnalyse).toHaveBeenCalledWith({ separate: false, limitSec: 90 });
  });

  it('passes both choices together when separation and the whole file are picked', () => {
    const onAnalyse = vi.fn();
    render(<AudioImportDialog {...base} pending={longPending} onAnalyse={onAnalyse} />);

    fireEvent.click(screen.getByRole('radio', { name: /separate instrument parts/i }));
    fireEvent.click(screen.getByRole('radio', { name: /all 11:59/i }));
    fireEvent.click(screen.getByRole('button', { name: /listen to it/i }));

    expect(onAnalyse).toHaveBeenCalledWith({ separate: true, limitSec: null });
  });

  it('greys out separation where the server cannot do it, and says so', () => {
    render(
      <AudioImportDialog
        {...base}
        pending={shortPending}
        canSeparate={false}
        onAnalyse={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: /separate instrument parts/i })).toBeDisabled();
    expect(screen.getByText(/not available on this server/i)).toBeInTheDocument();
  });

  it('drops the question once the analysis is under way', () => {
    render(<AudioImportDialog {...base} pending={shortPending} busy />);
    expect(screen.queryByRole('button', { name: /listen to it/i })).toBeNull();
  });

  it('drops the question once there is something to import', () => {
    render(
      <AudioImportDialog {...base} pending={shortPending} analysis={{ bpm: 114, notes: [] }} />,
    );
    expect(screen.queryByRole('button', { name: /listen to it/i })).toBeNull();
  });

  it('says which step is running, rather than one unchanging line for minutes', () => {
    render(<AudioImportDialog {...base} busy busyLabel="Listening to the drums…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Listening to the drums…');
  });
});
