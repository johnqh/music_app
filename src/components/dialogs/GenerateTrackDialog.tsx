/**
 * Generating one track with AI and adding it to the open score.
 *
 * A prompt box plus an instrument, because the generation request needs a GM
 * program and clef regardless — defaulting silently to Piano would answer
 * "add a bass line" with a piano-programmed track, which reads as the feature
 * being broken rather than under-specified.
 *
 * `FormModal` rather than `Dialog`: full-screen on a phone, centred dialog
 * from `sm` up, with the title bar and sticky confirm button supplied. It also
 * owns the confirm-disabled state, so the blank-prompt guard is `canSave`
 * rather than a check inside the handler.
 */
import { useEffect, useState } from 'react';
import { FormModal } from '@sudobility/components';
import { GM_FAMILIES, GM_FAMILY_LABELS, gmInstrumentsByFamily } from '@sudobility/music_lib';

const INSTRUMENTS = GM_FAMILIES.flatMap((family) =>
  gmInstrumentsByFamily(family).map((instrument) => ({
    program: instrument.program,
    name: instrument.name,
    group: GM_FAMILY_LABELS[family],
  })),
);

export type GenerateTrackDialogProps = {
  open: boolean;
  pending: boolean;
  error?: string | null;
  onGenerate: (prompt: string, midiProgram: number) => void;
  onClose: () => void;
};

export function GenerateTrackDialog({
  open,
  pending,
  error,
  onGenerate,
  onClose,
}: GenerateTrackDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [program, setProgram] = useState(0);

  useEffect(() => {
    if (open) setPrompt('');
  }, [open]);

  const trimmed = prompt.trim();

  return (
    <FormModal
      open={open}
      title="Generate track"
      onClose={onClose}
      onSave={() => onGenerate(trimmed, program)}
      saving={pending}
      canSave={trimmed.length > 0}
      saveLabel="Generate"
      size="small"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-theme-text-secondary">
          Adds one new track to this score, matching its key, tempo and length.
        </p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-theme-text-secondary">What should it play?</span>
          <textarea
            aria-label="Prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A walking bass line under the melody"
            className="rounded border border-theme-border bg-theme-surface px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-theme-text-secondary">Instrument</span>
          <select
            aria-label="Instrument"
            value={program}
            onChange={(e) => setProgram(Number(e.target.value))}
            className="rounded border border-theme-border bg-theme-surface px-2 py-1"
          >
            {INSTRUMENTS.map((i) => (
              <option key={i.program} value={i.program}>
                {i.name}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </FormModal>
  );
}
