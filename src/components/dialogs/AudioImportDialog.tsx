/**
 * Importing a recording as a project.
 *
 * Nothing is analysed here any more. The file is handed to the server, which
 * separates it, transcribes each part and sends back a score — so this dialog
 * picks a file, says what will happen, and uploads. The models, the worker and
 * the four megabytes of weights that used to make this the heaviest screen in
 * the app all live in `midi_transcriber_api` now.
 *
 * There is no tempo field and no confirm step, because the score does not exist
 * yet when the dialog closes: the project is created immediately in a
 * `transcribing` state and fills itself in when the job lands.
 */
import { useState } from 'react';
import { FileImportModal } from '@/components/dialogs/FileImportModal';

export type AudioImportDialogProps = {
  open: boolean;
  /** True while the file is being uploaded. */
  busy?: boolean;
  /** Why the recording could not be sent, when it could not. */
  error?: string | null;
  /** Whether this deployment can transcribe at all. */
  canTranscribe?: boolean;
  /** Hands the picked file up to be uploaded. */
  onImport: (file: File) => void;
  onClose: () => void;
};

/**
 * Longer than this and the dialog says so before uploading.
 *
 * A warning rather than a choice: trimming would mean decoding the audio here,
 * which is the one thing that would put a codec back in this bundle. The server
 * enforces its own maximum and refuses anything past it.
 */
const LONG_AUDIO_BYTES = 12 * 1024 * 1024;

/** Roughly, from the file size — no decoding, so this cannot be exact. */
function roughMinutes(bytes: number): number {
  // ~1MB per minute at a typical 128kbps mp3.
  return Math.max(1, Math.round(bytes / (1024 * 1024)));
}

export function AudioImportDialog({
  open,
  busy = false,
  error,
  canTranscribe = true,
  onImport,
  onClose,
}: AudioImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);

  const long = file !== null && file.size > LONG_AUDIO_BYTES;

  return (
    <FileImportModal
      open={open}
      title="Import audio"
      accept=".wav,.mp3,.mpa,audio/wav,audio/mpeg"
      fileKind="audio file"
      fileName={file?.name ?? null}
      onFile={setFile}
      busy={busy}
      busyLabel="Sending the recording…"
      error={error ?? null}
      canImport={Boolean(file) && canTranscribe}
      onImport={() => {
        if (file) onImport(file);
      }}
      onClose={() => {
        setFile(null);
        onClose();
      }}
      description={
        <>
          Turns a recording into a project, split into parts — vocals, drums, bass, guitar, piano
          and the rest, each on its own track. It runs on the server and takes a few minutes, so the
          project appears straight away and fills itself in when it is done. Expect a sketch to
          edit, not a copy of the record. WAV, MP3 and MPA.
        </>
      }
    >
      {!canTranscribe && (
        <p role="status" className="text-sm text-theme-text-secondary">
          Audio transcription is not available on this server.
        </p>
      )}
      {long && canTranscribe && (
        // Said rather than prevented: the server has the real limit, and this
        // cannot know the true duration without decoding the file.
        <p className="text-sm text-theme-text-secondary">
          That is a large file — roughly {roughMinutes(file.size)} minutes. Transcribing it will
          take a while, and very long recordings are refused.
        </p>
      )}
    </FileImportModal>
  );
}
