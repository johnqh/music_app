/**
 * Importing a recording as notes.
 *
 * Two-stage on purpose: pick a file, see what was heard, then commit. The
 * monophonic limitation is stated up front rather than left to be discovered
 * by importing a band recording and concluding the feature is broken.
 *
 * Built on `FileImportModal` so it looks and behaves like every other import on
 * the Projects screen. It used to render a bare `<input type="file">` — the
 * browser's own look, not the app's — and, worse, showed **nothing at all**
 * between picking a file and the analysis arriving. Decoding an MP3 and running
 * pitch detection over it takes seconds on a short clip and much longer on a
 * real recording, so choosing a file looked like it had done nothing, and a
 * file that failed to decode looked the same as one still being read.
 */
import { useEffect, useState } from 'react';
import type { Transcription } from '@sudobility/music_lib';
import { FileImportModal } from '@/components/dialogs/FileImportModal';

export type AudioImportDialogProps = {
  open: boolean;
  /** Present once a file has been decoded and analysed. */
  analysis?: Transcription;
  onFile: (file: File) => void;
  /** True while the picked file is being decoded and transcribed. */
  busy?: boolean;
  /** How far the analysis has got, 0..1, when that is known. */
  progress?: number | null;
  /** Why the recording could not be read, when it could not. */
  error?: string | null;
  /** Commits at `bpm`, which is the detected value unless it was corrected. */
  onImport: (bpm: number) => void;
  onClose: () => void;
};

export function AudioImportDialog({
  open,
  analysis,
  onFile,
  busy = false,
  progress = null,
  error,
  onImport,
  onClose,
}: AudioImportDialogProps) {
  const [bpm, setBpm] = useState<number>(analysis?.bpm ?? 120);
  const [fileName, setFileName] = useState<string | null>(null);

  // The detected tempo arrives with the analysis, so the field follows it.
  useEffect(() => {
    if (analysis) setBpm(analysis.bpm);
  }, [analysis]);

  return (
    <FileImportModal
      open={open}
      title="Import audio"
      accept=".wav,.mp3,.mpa,audio/wav,audio/mpeg"
      fileKind="audio file"
      fileName={fileName}
      onFile={(file) => {
        setFileName(file.name);
        onFile(file);
      }}
      busy={busy}
      busyLabel="Listening to the recording…"
      progress={progress}
      error={error ?? null}
      canImport={Boolean(analysis)}
      onImport={() => onImport(bpm)}
      onClose={onClose}
      description={
        <>
          Turns a recording into notes on a new track. Works on <strong>one melodic line</strong> at
          a time — singing, humming, or a single-note instrument. Chords and full mixes will not
          transcribe. WAV, MP3 and MPA.
        </>
      }
    >
      {analysis && (
        <>
          <p className="text-sm text-theme-text-primary">
            Heard {analysis.notes.length} note{analysis.notes.length === 1 ? '' : 's'}.
          </p>
          {analysis.notes.length === 0 && (
            <p className="text-xs text-theme-text-secondary">
              Nothing came through as a pitched line. A chord-heavy or percussive recording will do
              this, and so will one that is mostly silence.
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-theme-text-secondary">Tempo</span>
            <input
              type="number"
              aria-label="Tempo"
              value={bpm}
              min={20}
              max={300}
              onChange={(e) => setBpm(Number(e.target.value))}
              className="w-28 rounded border border-theme-border bg-theme-surface px-2 py-1"
            />
            <span className="text-xs text-theme-text-secondary">
              Detected from the recording. Change it if the notes land wrong.
            </span>
          </label>
        </>
      )}
    </FileImportModal>
  );
}
