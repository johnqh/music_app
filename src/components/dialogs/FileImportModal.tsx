/**
 * The one file-import modal, shared by every import on the Projects screen.
 *
 * **Opens the OS picker directly.** Choosing a format used to land on a
 * screen that only explained the format and offered a "Choose file…"
 * button — a second click standing between the choice and the picker,
 * paid on every import. The hidden `<input type="file">` is now clicked
 * automatically the moment this opens, and the visible dialog (title,
 * description, footer) stays off screen until there is something to show
 * it for — a file read, a busy line, or an error. Cancelling the OS picker
 * without choosing a file closes the whole thing, via the native `cancel`
 * event `<input type="file">` fires (Chrome 113+, Firefox 106+, Safari
 * 16.4+); nothing here has ever been shown for that to dismiss.
 *
 * The input is rendered *outside* `FormModal`'s children, as a sibling,
 * because it has to exist and be clickable the instant `open` becomes
 * true — before there is any content, which is exactly when `FormModal`
 * itself is not yet shown. Its visible stand-in inside the dialog is a
 * `<label htmlFor>` pointing at the same persistent input by id rather
 * than wrapping it, since the input can no longer live inside the part
 * that mounts late.
 *
 * What it standardises once a file exists: the chooser (now a re-pick
 * label showing the chosen file's name), a sentence saying what the
 * import produces, a busy line while the file is read, an error line
 * when it cannot be, and the footer. Anything format-specific — a track
 * table, a detected tempo — comes in as `children` below all that, so
 * each import stays as rich as it needs to be.
 */
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FormModal, Spinner, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';

export type FileImportModalProps = {
  open: boolean;
  /** e.g. "Import MIDI". Owned by `FormModal`, which also names the dialog. */
  title: string;
  /** One or two sentences on what this import produces. */
  description?: ReactNode;
  /** The `accept` attribute — extensions and MIME types this import can read. */
  accept: string;
  /**
   * What to call the file in the chooser and in the input's accessible name,
   * e.g. "MIDI file". Kept separate from `title` so the button reads
   * "Choose MIDI file…" rather than "Choose Import MIDI…".
   */
  fileKind: string;
  /** The chosen file's name, shown on the chooser once one is picked. */
  fileName?: string | null;
  onFile: (file: File) => void;
  /** True while the file is being read or analysed. */
  busy?: boolean;
  /** What the busy line says, e.g. "Listening to the recording…". */
  busyLabel?: string;
  /**
   * How far the work has got, 0..1 — optional, and only worth passing when the
   * number is real.
   *
   * With it the busy line becomes a determinate bar; without it, the spinner
   * alone. That split is deliberate: a bar that cannot move (because the work
   * blocks the thread, or because nothing is counting) is worse than a spinner,
   * since it invites the reader to estimate a finish that will never approach.
   */
  progress?: number | null;
  error?: string | null;
  /** Whether the import can be committed — usually "a file has been read". */
  canImport: boolean;
  importLabel?: string;
  onImport: () => void;
  onClose: () => void;
  size?: 'small' | 'medium' | 'large';
  /** Format-specific fields, shown under the chooser once there is something to show. */
  children?: ReactNode;
};

export function FileImportModal({
  open,
  title,
  description,
  accept,
  fileKind,
  fileName,
  onFile,
  busy = false,
  busyLabel,
  progress = null,
  error,
  canImport,
  importLabel,
  onImport,
  onClose,
  size = 'small',
  children,
}: FileImportModalProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // Resolved here, not as parameter defaults: a default is evaluated once at
  // module scope and would freeze the label in the language loaded first.
  const busyText = busyLabel ?? t('import.readingFile');
  const importText = importLabel ?? t('import.action');
  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Cleared so picking the *same* file again still fires a change event —
    // which is what happens after a failed read, when retrying the same file
    // is the obvious thing to try.
    event.target.value = '';
    if (file) onFile(file);
  };

  /*
    Opens the OS picker itself, the moment there is one to open.

    `useLayoutEffect`, not `useEffect`: React 18 flushes layout effects
    synchronously within the same discrete event that changed `open` (the
    format being chosen), which is still inside the click's "user
    activation" window every browser requires before it will honour a
    programmatic `.click()` on a file input. `useEffect`'s passive effects
    run after paint, outside that window, and the picker silently would not
    open — the one failure mode that would be invisible in testing and
    obvious to every reader.
  */
  useLayoutEffect(() => {
    if (open) inputRef.current?.click();
  }, [open]);

  /*
    Cancelling the OS picker before anything was chosen closes the whole
    flow — there is nothing on screen yet for a reader to dismiss instead.
    Guarded on `fileName`: once a file exists, a *later* re-pick that gets
    cancelled must leave the dialog exactly as it was, not close what the
    reader is looking at.
  */
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !open) return;
    const handleCancel = (): void => {
      if (!fileName) onClose();
    };
    input.addEventListener('cancel', handleCancel);
    return () => input.removeEventListener('cancel', handleCancel);
  }, [open, fileName, onClose]);

  const hasContent = busy || Boolean(fileName) || Boolean(error);

  return (
    <>
      {/*
        Outside `FormModal`'s children on purpose — see the file comment.
        Always in the DOM whenever `open` is true, regardless of whether
        the dialog itself has anything to show yet.
      */}
      {open && (
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          className="sr-only"
          aria-label={t('import.fileInput', { kind: fileKind })}
          disabled={busy}
          onChange={handleChange}
        />
      )}

      <FormModal
        open={open && hasContent}
        title={title}
        onClose={onClose}
        size={size}
        // `actions`, not `onSave`: a Cancel belongs beside an import that creates
        // a project, and the shorthand renders one full-width button.
        actions={[
          { label: t('common.cancel'), onClick: onClose },
          { label: importText, onClick: onImport, disabled: !canImport || busy },
        ]}
        // The top-bar × is named "Cancel" by default, which would collide with
        // the footer's Cancel and make both ambiguous.
        closeAriaLabel={t('common.closeDialog')}
      >
        {/* FormModal renders the title and names its own dialog, so neither is
            repeated here. */}
        <div className="flex flex-col gap-4">
          {description && <div className="text-sm text-muted-foreground">{description}</div>}

          <label
            htmlFor={inputId}
            role="button"
            tabIndex={0}
            aria-label={t('import.chooseFile', { kind: fileKind })}
            className={cn(
              variants.button.outline.default(),
              'cursor-pointer px-3 py-2 text-center',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            {fileName ?? t('import.chooseFileEllipsis', { kind: fileKind })}
          </label>

          {busy && (
            <div className="flex flex-col gap-2">
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                {/* Decorative: the text beside it is the announcement. */}
                <span aria-hidden="true">
                  <Spinner ariaLabel="Working" size="small" />
                </span>
                {busyText}
                {progress !== null && (
                  <span className="tabular-nums">{Math.round(progress * 100)}%</span>
                )}
              </div>
              {progress !== null && (
                <div
                  role="progressbar"
                  aria-label={busyText}
                  aria-valuenow={Math.round(progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1 w-full overflow-hidden rounded-full bg-border"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-150"
                    style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {children}
        </div>
      </FormModal>
    </>
  );
}
