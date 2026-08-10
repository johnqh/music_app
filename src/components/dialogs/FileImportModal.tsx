/**
 * The one file-import modal, shared by every import on the Projects screen.
 *
 * They had drifted into three different shapes: MIDI and MusicXML each opened a
 * modal with their own hand-rolled chooser, Audio opened a modal with a raw
 * `<input type="file">` (whose look is the browser's, not the app's), and
 * `.MOD` and Project JSON skipped the modal entirely and jumped straight to the
 * OS picker — so two of the five gave no title, no description of what the
 * import would do, and nowhere to report a bad file.
 *
 * What it standardises: the chooser (a button that becomes the chosen file's
 * name), a sentence saying what the import produces, a busy line while the file
 * is being read, an error line when it cannot be, and the footer. Anything
 * format-specific — a track table, a detected tempo — comes in as `children`
 * below all that, so each import stays as rich as it needs to be.
 *
 * A `<label>` wrapping a hidden input rather than a `<button>`: only a real
 * file input opens the browser's picker, and only a label can front one
 * without script. `role="button"` keeps it addressable as the control it is.
 */
import type { ChangeEvent, ReactNode } from 'react';
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
  busyLabel = 'Reading the file…',
  progress = null,
  error,
  canImport,
  importLabel = 'Import',
  onImport,
  onClose,
  size = 'small',
  children,
}: FileImportModalProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Cleared so picking the *same* file again still fires a change event —
    // which is what happens after a failed read, when retrying the same file
    // is the obvious thing to try.
    event.target.value = '';
    if (file) onFile(file);
  };

  return (
    <FormModal
      open={open}
      title={title}
      onClose={onClose}
      size={size}
      // `actions`, not `onSave`: a Cancel belongs beside an import that creates
      // a project, and the shorthand renders one full-width button.
      actions={[
        { label: 'Cancel', onClick: onClose },
        { label: importLabel, onClick: onImport, disabled: !canImport || busy },
      ]}
      // The top-bar × is named "Cancel" by default, which would collide with
      // the footer's Cancel and make both ambiguous.
      closeAriaLabel="Close dialog"
    >
      {/* FormModal renders the title and names its own dialog, so neither is
          repeated here. */}
      <div className="flex flex-col gap-4">
        {description && <div className="text-sm text-theme-text-secondary">{description}</div>}

        <label
          role="button"
          tabIndex={0}
          aria-label={`Choose ${fileKind}`}
          className={cn(
            variants.button.outline.default(),
            'cursor-pointer px-3 py-2 text-center',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          {fileName ?? `Choose ${fileKind}…`}
          <input
            type="file"
            accept={accept}
            className="sr-only"
            aria-label={`${fileKind} input`}
            disabled={busy}
            onChange={handleChange}
          />
        </label>

        {busy && (
          <div className="flex flex-col gap-2">
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-sm text-theme-text-secondary"
            >
              {/* Decorative: the text beside it is the announcement. */}
              <span aria-hidden="true">
                <Spinner ariaLabel="Working" size="small" />
              </span>
              {busyLabel}
              {progress !== null && (
                <span className="tabular-nums">{Math.round(progress * 100)}%</span>
              )}
            </div>
            {progress !== null && (
              <div
                role="progressbar"
                aria-label={busyLabel}
                aria-valuenow={Math.round(progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1 w-full overflow-hidden rounded-full bg-theme-border"
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
          <div role="alert" className="rounded-md bg-red-600/10 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {children}
      </div>
    </FormModal>
  );
}
