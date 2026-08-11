/**
 * Importing a recording as **separate instrument parts**.
 *
 * The whole-mix import hears notes, not instruments, so a band comes back as
 * one dense track. This route sends the recording to be split into stems first
 * and then hears each stem on its own, which is what turns a song into parts.
 *
 * Everything it needs is injected. The steps are a network call, a poll, a
 * model and three codecs, and none of them can run in jsdom — so the sequence,
 * which is the part that goes wrong, is only testable if the pieces are
 * replaceable. That is the same reason `AudioTranscriber` takes a `createWorker`.
 *
 * The tempo is detected **once, across every stem**, and then used to convert
 * all of them. Per-stem tempo would let the bass and the drums disagree, and
 * they cannot: they are the same performance. Drum onsets carry most of the
 * beat evidence, which is why they are included rather than converted
 * separately.
 */
import {
  detectTempo,
  drumHitsToNotes,
  scoreStems,
  transcribeDrums,
  type DrumHit,
  type TranscribedStem,
} from '@sudobility/music_lib';
import type { DecodedAudio, HeardNote, Separation, StemKind } from '@sudobility/music_types';

/** What the dialog shows while this runs. */
export type SeparationProgress = {
  /** Shown to the reader, so it says what is happening rather than naming a step. */
  label: string;
  /** 0..1 where it is knowable, null where it is not. */
  fraction: number | null;
};

export type SeparateImportDeps = {
  /** Encodes the mix for upload, and decodes each stem that comes back. */
  encodeWav: (audio: DecodedAudio) => ArrayBuffer;
  decode: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
  /** The pitched-note model. Drums do not go through it — it hears no drums. */
  transcribe: (audio: DecodedAudio, onProgress?: (f: number) => void) => Promise<HeardNote[]>;
  createSeparation: (audio: Blob) => Promise<Separation>;
  getSeparation: (id: string) => Promise<Separation>;
  /** Fetches one stem's audio. Binary, so it cannot go through the JSON client. */
  fetchStem: (id: string, kind: StemKind) => Promise<ArrayBuffer>;
  onProgress?: (progress: SeparationProgress) => void;
  /** Injected so a test does not wait. */
  sleep?: (ms: number) => Promise<void>;
};

export type SeparateImportResult = {
  bpm: number;
  stems: TranscribedStem[];
};

/** How often the separation is polled, and how long before it is given up on. */
const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class SeparationFailedError extends Error {}

/** Waits for the separation to leave `running`. */
async function awaitStems(deps: SeparateImportDeps, id: string): Promise<Separation> {
  const sleep = deps.sleep ?? defaultSleep;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  for (;;) {
    const separation = await deps.getSeparation(id);
    if (separation.status === 'ready') return separation;
    if (separation.status === 'failed') {
      throw new SeparationFailedError(separation.error ?? 'The recording could not be separated');
    }
    if (Date.now() > deadline) {
      throw new SeparationFailedError('Separating the recording took too long');
    }
    await sleep(POLL_MS);
  }
}

/**
 * A recording → one transcription per stem, at one shared tempo.
 *
 * Stems are handled **in sequence**, not in parallel: each one runs the same
 * model, and the model holds GPU memory for as long as it is working. Six at
 * once is six times the memory for the same total work, on a machine that is
 * also drawing the page.
 */
export async function separateAndTranscribe(
  audio: DecodedAudio,
  deps: SeparateImportDeps,
): Promise<SeparateImportResult> {
  const report = (label: string, fraction: number | null): void => {
    deps.onProgress?.({ label, fraction });
  };

  report('Uploading the recording…', null);
  const wav = deps.encodeWav(audio);
  const separation = await deps.createSeparation(new Blob([wav], { type: 'audio/wav' }));

  report('Separating the instruments…', null);
  const ready = await awaitStems(deps, separation.id);

  // Seconds first, ticks once the tempo is known — the tempo is what converts
  // them, and it is not known until every stem has been heard.
  const heardByStem = new Map<StemKind, HeardNote[]>();
  const drumsByStem = new Map<StemKind, DrumHit[]>();
  const onsets: number[] = [];

  const stems = ready.stems;
  for (const [index, kind] of stems.entries()) {
    const share = (f: number): number => (index + f) / stems.length;
    report(`Listening to the ${kind}…`, share(0));

    const bytes = await deps.fetchStem(ready.id, kind);
    const stemAudio = await deps.decode(bytes);

    if (kind === 'drums') {
      // Not through the pitched model: it reports no drums at all, which is
      // what made a transcription of a full mix unrecognisable.
      const hits = transcribeDrums(stemAudio.samples, stemAudio.sampleRate);
      drumsByStem.set(kind, hits);
      for (const hit of hits) onsets.push(hit.startSec);
    } else {
      const heard = await deps.transcribe(stemAudio, (f) =>
        report(`Listening to the ${kind}…`, share(f)),
      );
      heardByStem.set(kind, heard);
      for (const note of heard) onsets.push(note.startSec);
    }
  }

  const bpm = detectTempo(onsets);
  const ppq = TRANSCRIPTION_PPQ;
  const ticksPerSecond = (bpm / 60) * ppq;

  const transcribed: TranscribedStem[] = [];
  for (const [kind, heard] of heardByStem) {
    transcribed.push({
      kind,
      notes: heard.map((note) => ({
        midi: note.midi,
        startTick: Math.max(0, Math.round(note.startSec * ticksPerSecond)),
        // At least one tick: a note rounding to zero length would vanish.
        durationTicks: Math.max(1, Math.round(note.durationSec * ticksPerSecond)),
      })),
    });
  }
  for (const [kind, hits] of drumsByStem) {
    transcribed.push({ kind, notes: drumHitsToNotes(hits, bpm, ppq) });
  }

  report('Building the score…', 1);
  // Ordered, and silent stems dropped — a song with no guitar still comes back
  // with a guitar stem, and an empty track for it is a part nobody played.
  return { bpm, stems: scoreStems(transcribed) };
}

/** The resolution transcriptions are emitted against. Matches the whole-mix import. */
export const TRANSCRIPTION_PPQ = 480;
