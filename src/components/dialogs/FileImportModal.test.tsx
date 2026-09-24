import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileImportModal } from '@/components/dialogs/FileImportModal';

function renderModal(overrides: Partial<React.ComponentProps<typeof FileImportModal>> = {}) {
  const props = {
    open: true,
    title: 'Import audio',
    accept: '.wav,.mp3',
    fileKind: 'audio file',
    onFile: vi.fn(),
    canImport: false,
    onImport: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<FileImportModal {...props} />);
  return props;
}

describe('FileImportModal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the OS picker itself, with no explaining screen first', () => {
    // The whole point: choosing a format used to land on a screen that only
    // explained it and offered a "Choose file…" button, a second click
    // before the picker. There is nothing to explain until a file exists.
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    renderModal();
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not re-open the picker on a re-render that leaves `open` unchanged', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    const { rerender } = render(<FileImportModal {...baseProps()} />);
    expect(click).toHaveBeenCalledTimes(1);
    // A prop unrelated to `open` changing (busy ticking on) must not fire a
    // second picker — the reader would see it open again under their cursor.
    rerender(<FileImportModal {...baseProps()} busy />);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('closes the whole flow when the OS picker is cancelled before anything is chosen', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const input = screen.getByLabelText('audio file input');
    input.dispatchEvent(new Event('cancel', { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on a cancelled re-pick once a file is already chosen', () => {
    // Cancelling a *second* pick, made to change the file, must leave the
    // dialog exactly as it was rather than dismissing what is on screen.
    const onClose = vi.fn();
    renderModal({ onClose, fileName: 'take-3.mp3' });
    const input = screen.getByLabelText('audio file input');
    input.dispatchEvent(new Event('cancel', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays off screen with nothing chosen, nothing busy and nothing wrong', () => {
    renderModal();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the dialog after the import, and the picker after the file, once there is something to show', () => {
    // `FormModal` labels itself from `title`; the chooser says what to bring.
    // `busy` is what makes there be something to show without a real file.
    renderModal({ busy: true });
    expect(screen.getByRole('dialog', { name: 'Import audio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose audio file')).toBeInTheDocument();
    expect(screen.getByLabelText('audio file input')).toHaveAttribute('accept', '.wav,.mp3');
  });

  it('shows the chosen file instead of the prompt', () => {
    renderModal({ fileName: 'take-3.mp3' });
    expect(screen.getByLabelText('Choose audio file')).toHaveTextContent('take-3.mp3');
  });

  it('says it is working while the file is being read', () => {
    // The audio import used to show nothing at all between picking a file and
    // the analysis arriving — seconds of apparent inaction on an MP3.
    renderModal({ busy: true, busyLabel: 'Listening to the recording…' });
    expect(screen.getByRole('status')).toHaveTextContent('Listening to the recording…');
  });

  it('shows only a spinner when there is no progress to report', () => {
    // A bar that cannot move is worse than a spinner: it invites the reader to
    // estimate a finish that will never approach.
    renderModal({ busy: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows a determinate bar once a real fraction is passed', () => {
    renderModal({ busy: true, busyLabel: 'Listening to the recording…', progress: 0.42 });
    const bar = screen.getByRole('progressbar', { name: 'Listening to the recording…' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('clamps a fraction outside 0..1 rather than overflowing the track', () => {
    renderModal({ busy: true, progress: 1.4 });
    const fill = screen.getByRole('progressbar').firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('hides the bar again when the work is done, but stays open on the file already chosen', () => {
    renderModal({ busy: false, progress: 0.5, fileName: 'take-3.mp3' });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cannot be committed while busy, even once there is something to import', () => {
    renderModal({ busy: true, canImport: true });
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('reports a file it could not read, in the dialog rather than only as a toast', () => {
    // A toast over a modal is easy to miss, and the modal is where the user is
    // looking after picking a file.
    renderModal({ error: 'That file could not be read as audio.' });
    expect(screen.getByRole('alert')).toHaveTextContent('That file could not be read as audio.');
  });

  it('hands the picked file up, and clears the input so the same file can be retried', async () => {
    // Retrying the identical file after a failed read is the obvious next
    // move, and a file input fires no change event for an unchanged value.
    const props = renderModal();
    const input = screen.getByLabelText('audio file input') as HTMLInputElement;
    const file = new File(['id3'], 'take-3.mp3', { type: 'audio/mpeg' });

    await userEvent.upload(input, file);

    expect(props.onFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('offers Cancel beside Import, and does not name the close button the same thing', async () => {
    // Two controls with one accessible name are ambiguous aloud and a
    // strict-mode failure in tests. Needs content on screen to find either.
    const props = renderModal({ fileName: 'take-3.mp3' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });
});

function baseProps(): React.ComponentProps<typeof FileImportModal> {
  return {
    open: true,
    title: 'Import audio',
    accept: '.wav,.mp3',
    fileKind: 'audio file',
    onFile: vi.fn(),
    canImport: false,
    onImport: vi.fn(),
    onClose: vi.fn(),
  };
}
