/**
 * Sample-project seeding (spec §19: "At least three sample projects: 1)
 * simple piano melody; 2) four-track pop arrangement; 3) short
 * orchestral-style passage"). Built via `MockGenerationProvider` with fixed
 * seeds, so every install produces byte-for-byte identical scores — no
 * checked-in fixture JSON to keep in sync with the generator.
 *
 * `installSampleProjects` is idempotent: it skips any sample whose name
 * already exists among the current projects, so calling it again (e.g. on
 * every app boot, per spec §32) never creates duplicates.
 */
import { MockGenerationProvider } from '@/services/generation/mock-provider';
import type { GenerateScoreRequest } from '@/services/generation/types';
import type { ProjectRecord, ScoreSmithDb } from '@/services/persistence/db';
import { createProject, listProjects } from '@/services/persistence/projects';

type SampleDefinition = {
  name: string;
  /** Fixed per-sample seed: keeps this sample's content stable across installs/releases, and independent of the other samples' seeds. */
  seed: string;
  request: GenerateScoreRequest;
};

const GENTLE_PIANO_MELODY: SampleDefinition = {
  name: 'Gentle Piano Melody',
  seed: 'scoresmith-sample-gentle-piano-melody-v1',
  request: {
    prompt: 'Create a gentle eight-measure piano melody in C major',
    title: 'Gentle Piano Melody',
    durationMeasures: 8,
    tempo: 96,
    keySignature: { fifths: 0, mode: 'major' },
    timeSignature: { numerator: 4, denominator: 4 },
    complexity: 'simple',
    tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
  },
};

const POP_ARRANGEMENT: SampleDefinition = {
  name: 'Pop Arrangement',
  seed: 'scoresmith-sample-pop-arrangement-v1',
  request: {
    prompt: 'Create an upbeat pop arrangement with piano, bass, drums, and strings',
    title: 'Pop Arrangement',
    durationMeasures: 16,
    tempo: 120,
    complexity: 'moderate',
    tracks: [
      { name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' },
      { name: 'Strings', instrumentName: 'String Ensemble', midiProgram: 48, clef: 'treble' },
      { name: 'Bass', instrumentName: 'Electric Bass', midiProgram: 33, clef: 'bass' },
      { name: 'Drums', instrumentName: 'Drum Kit', midiProgram: 0, clef: 'percussion' },
    ],
  },
};

const ORCHESTRAL_PASSAGE: SampleDefinition = {
  name: 'Orchestral Passage',
  seed: 'scoresmith-sample-orchestral-passage-v1',
  request: {
    prompt: 'Create a cinematic twelve-measure orchestral passage in D minor',
    title: 'Orchestral Passage',
    durationMeasures: 12,
    tempo: 88,
    keySignature: { fifths: -1, mode: 'minor' },
    complexity: 'complex',
    tracks: [
      { name: 'Violin I', instrumentName: 'Violin', midiProgram: 40, clef: 'treble' },
      { name: 'Violin II', instrumentName: 'Violin', midiProgram: 40, clef: 'treble' },
      { name: 'Cello & Bass', instrumentName: 'Cello', midiProgram: 42, clef: 'bass' },
    ],
  },
};

/** The three built-in sample projects (spec §19), in install order. */
export const SAMPLE_DEFINITIONS: readonly SampleDefinition[] = [
  GENTLE_PIANO_MELODY,
  POP_ARRANGEMENT,
  ORCHESTRAL_PASSAGE,
];

/**
 * Installs any sample project (from `SAMPLE_DEFINITIONS`) not already
 * present in `db` (matched by name), generating each via a fresh
 * `MockGenerationProvider` seeded per-sample. Returns the records that were
 * actually created (empty if every sample already existed). Safe to call
 * on every app boot: a second call with the same `db` creates nothing.
 */
export async function installSampleProjects(db: ScoreSmithDb): Promise<ProjectRecord[]> {
  const existingNames = new Set((await listProjects(db)).map((project) => project.name));
  const created: ProjectRecord[] = [];

  for (const sample of SAMPLE_DEFINITIONS) {
    if (existingNames.has(sample.name)) continue;

    const provider = new MockGenerationProvider({ seed: sample.seed });
    const { score } = await provider.generateScore(sample.request);
    const record = await createProject(db, { name: sample.name, score });
    created.push(record);
  }

  return created;
}
