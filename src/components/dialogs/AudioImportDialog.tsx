/**
 * Importing a recording as notes.
 *
 * Two-stage on purpose: pick a file, see what was heard, then commit. The
 * monophonic limitation is stated up front rather than left to be discovered
 * by importing a band recording and concluding the feature is broken.
 */
import { useEffect, useState } from 'react';
import { FormModal } from '@sudobility/components';
import type { Transcription } from '@sudobility/music_lib';

export type AudioImportDialogProps = {
  open: boolean;
  /** Present once a file has been decoded and analysed. */
  analysis?: Transcription;
  onFile: (file: File) => void;
  /** Commits at `bpm`, which is the detected value unless it was corrected. */
  onImport: (bpm: number) => void;
  onClose: () => void;
};

export function AudioImportDialog({
  open,
  analysis,
  onFile,
  onImport,
  onClose,
}: AudioImportDialogProps) {
  const [bpm, setBpm] = useState<number>(analysis?.bpm ?? 120);

  // The detected tempo arrives with the analysis, so the field follows it.
  useEffect(() => {
    if (analysis) setBpm(analysis.bpm);
  }, [analysis]);

  return (
    <FormModal
      open={open}
      title="Import audio"
      onClose={onClose}
      onSave={() => onImport(bpm)}
      canSave={Boolean(analysis)}
      saveLabel="Import"
      size="small"
    >
      {/* FormModal renders the title and names its own dialog, so this carries
          neither -- a heading here would print "Import audio" twice. */}
      <div className="flex flex-col gap-4">
        <p className="text-sm text-theme-text-secondary">
          Turns a recording into notes on a new track. Works on <strong>one melodic line</strong> at
          a time — singing, humming, or a single-note instrument. Chords and full mixes will not
          transcribe.
        </p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-theme-text-secondary">Audio file</span>
          <input
            type="file"
            aria-label="Audio file"
            accept=".wav,.mp3,.mpa,audio/wav,audio/mpeg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </label>

        {analysis && (
          <>
            <p className="text-sm text-theme-text-primary">
              Heard {analysis.notes.length} note{analysis.notes.length === 1 ? '' : 's'}.
            </p>
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
      </div>
    </FormModal>
  );
}
