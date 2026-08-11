import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioImportDialog } from '@/components/dialogs/AudioImportDialog';

function props(overrides: Partial<React.ComponentProps<typeof AudioImportDialog>> = {}) {
  return { open: true, onImport: vi.fn(), onClose: vi.fn(), ...overrides };
}

const audioFile = (name = 'take.mp3', bytes = 1024) =>
  new File([new Uint8Array(bytes)], name, { type: 'audio/mpeg' });

describe('AudioImportDialog', () => {
  it('says what the import produces, and what it does not', () => {
    // It makes a whole project of separate parts, on the server, over minutes —
    // and it is a sketch rather than a copy of the record. Each of those is
    // something somebody would otherwise discover by being surprised.
    render(<AudioImportDialog {...props()} />);
    expect(screen.getByText(/split into parts/i)).toBeVisible();
    expect(screen.getByText(/takes a few minutes/i)).toBeVisible();
    expect(screen.getByText(/a sketch to edit, not a copy/i)).toBeVisible();
  });

  it('cannot be committed until a file has been chosen', () => {
    render(<AudioImportDialog {...props()} />);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('hands the picked file up when committed', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(<AudioImportDialog {...props({ onImport })} />);

    await user.upload(screen.getByLabelText('audio file input'), audioFile('hum.wav'));
    expect(screen.getByLabelText('Choose audio file')).toHaveTextContent('hum.wav');

    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ name: 'hum.wav' }));
  });

  it('says it is working while the recording is uploading', () => {
    render(<AudioImportDialog {...props({ busy: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Sending the recording…');
  });

  it('reports a recording it could not send', () => {
    render(<AudioImportDialog {...props({ error: 'That recording could not be sent.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be sent');
  });

  it('warns about a large file rather than refusing it', async () => {
    // A warning, not a choice: trimming would mean decoding the audio here,
    // which is the one thing that would put a codec back in this bundle. The
    // server enforces the real limit.
    const user = userEvent.setup();
    render(<AudioImportDialog {...props()} />);

    await user.upload(
      screen.getByLabelText('audio file input'),
      audioFile('long.mp3', 20 * 1024 * 1024),
    );

    expect(screen.getByText(/that is a large file/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  });

  it('says nothing about size for an ordinary file', async () => {
    const user = userEvent.setup();
    render(<AudioImportDialog {...props()} />);
    await user.upload(screen.getByLabelText('audio file input'), audioFile('short.mp3'));
    expect(screen.queryByText(/that is a large file/i)).toBeNull();
  });

  it('refuses to import where the server cannot transcribe, and says so', async () => {
    const user = userEvent.setup();
    render(<AudioImportDialog {...props({ canTranscribe: false })} />);
    await user.upload(screen.getByLabelText('audio file input'), audioFile());

    expect(screen.getByText(/not available on this server/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('offers Cancel beside Import, under a different name from the close button', async () => {
    // Two controls with one accessible name are ambiguous aloud and a
    // strict-mode failure in tests.
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AudioImportDialog {...props({ onClose })} />);

    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
