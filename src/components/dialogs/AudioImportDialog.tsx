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
import { cn, variants } from '@sudobility/design';
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
  /**
   * Set once the file is decoded and waiting on a decision: how long it is, how
   * much an excerpt would cover, and above what length the question is asked.
   */
  pending?: { seconds: number; excerptSeconds: number; longerThanSec: number } | null;
  /** Whether the server can separate at all; false greys the option out. */
  canSeparate?: boolean;
  /**
   * What is happening right now, while busy.
   *
   * Separation is several steps — upload, wait, then a stem at a time — and one
   * unchanging "Listening to the recording…" through minutes of that reads as a
   * hang. Defaults to that line for the single-part path, which really is one
   * step.
   */
  busyLabel?: string;
  /** Start the analysis with the choices made. */
  onAnalyse?: (choice: { separate: boolean; limitSec: number | null }) => void;
  /** Commits at `bpm`, which is the detected value unless it was corrected. */
  onImport: (bpm: number) => void;
  onClose: () => void;
};

/** `m:ss`, the way a player shows a running time. */
function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function AudioImportDialog({
  open,
  analysis,
  onFile,
  busy = false,
  progress = null,
  error,
  pending = null,
  canSeparate = true,
  busyLabel,
  onAnalyse,
  onImport,
  onClose,
}: AudioImportDialogProps) {
  const [bpm, setBpm] = useState<number>(analysis?.bpm ?? 120);
  const [fileName, setFileName] = useState<string | null>(null);
  const [separate, setSeparate] = useState(false);
  /** Long recordings default to the excerpt: it is the one that finishes. */
  const [excerpt, setExcerpt] = useState(true);

  const isLong = pending !== null && pending.seconds > pending.longerThanSec;

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
      busyLabel={busyLabel ?? 'Listening to the recording…'}
      progress={progress}
      error={error ?? null}
      canImport={Boolean(analysis)}
      onImport={() => onImport(bpm)}
      onClose={onClose}
      description={
        <>
          Turns a recording into notes, <strong>chords included</strong> — singing, humming, a piano
          part, or a whole band. Heard as one part it finds notes but not instruments, so a mix
          arrives as one dense track; separated, it splits the recording up first and gives each
          instrument its own. Neither hears words, and neither is a transcription of a finished
          record — expect a sketch to edit, not a copy. WAV, MP3 and MPA.
        </>
      }
    >
      {pending && !analysis && !busy && (
        // Asked rather than assumed, on both counts. Silently transcribing the
        // opening minute would look like the rest of the file had been lost,
        // and silently transcribing all of a twelve-minute track is minutes of
        // waiting. Separation is a choice too: it is much slower and sends the
        // audio to a server, neither of which should happen by default.
        <div className="flex flex-col gap-3 rounded border border-theme-border bg-theme-surface p-3">
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm text-theme-text-secondary">What to make of it</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="audio-import-mode"
                className="mt-1"
                checked={!separate}
                onChange={() => setSeparate(false)}
              />
              <span>
                <strong>One part.</strong> Every note it hears on a single track. Fast, and stays on
                this machine.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="audio-import-mode"
                className="mt-1"
                checked={separate}
                onChange={() => setSeparate(true)}
                disabled={!canSeparate}
              />
              <span>
                <strong>Separate instrument parts.</strong> Splits the recording into vocals, drums,
                bass, guitar, piano and the rest, and hears each on its own track. Much slower, and
                the recording is sent to a separation service.
                {!canSeparate && ' Not available on this server.'}
              </span>
            </label>
          </fieldset>

          {isLong && (
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm text-theme-text-secondary">
                How much of it — this recording is {formatDuration(pending.seconds)} long
              </legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="audio-import-length"
                  checked={excerpt}
                  onChange={() => setExcerpt(true)}
                />
                <span>The first {formatDuration(pending.excerptSeconds)}</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="audio-import-length"
                  checked={!excerpt}
                  onChange={() => setExcerpt(false)}
                />
                <span>All {formatDuration(pending.seconds)}</span>
              </label>
            </fieldset>
          )}

          <div>
            <button
              type="button"
              onClick={() =>
                onAnalyse?.({
                  separate,
                  limitSec: isLong && excerpt ? pending.excerptSeconds : null,
                })
              }
              className={cn(variants.button.primary.default(), 'px-3 py-1.5 text-sm')}
            >
              Listen to it
            </button>
          </div>
        </div>
      )}

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
