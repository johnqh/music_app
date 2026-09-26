import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { GenerationJobDetail } from '@sudobility/music_types';
import { GeneratedOriginDetails, ProjectOriginPanel } from './ProjectOriginPanel';

afterEach(cleanup);

describe('ProjectOriginPanel', () => {
  it('names an import by its format and file', () => {
    render(
      <ProjectOriginPanel
        origin={{ kind: 'imported', format: 'midi', fileName: 'tune.mid' }}
        projectId="p1"
      />,
    );
    expect(screen.getByText('Imported from a file')).toBeTruthy();
    expect(screen.getByText('MIDI')).toBeTruthy();
    expect(screen.getByText('tune.mid')).toBeTruthy();
  });

  it('says a blank project started from nothing, and an unrecorded one that it is unknown', () => {
    const { unmount } = render(<ProjectOriginPanel origin={{ kind: 'blank' }} projectId="p1" />);
    expect(screen.getByText('Started from a blank score')).toBeTruthy();
    unmount();
    render(<ProjectOriginPanel origin={null} projectId="p1" />);
    expect(screen.getByText('Not recorded')).toBeTruthy();
  });

  it('names the recording a transcription came from', () => {
    render(
      <ProjectOriginPanel
        origin={{ kind: 'transcribed', fileName: 'take 3.wav' }}
        projectId="p1"
      />,
    );
    expect(screen.getByText('Transcribed from a recording')).toBeTruthy();
    expect(screen.getByText('take 3.wav')).toBeTruthy();
  });
});

describe('GeneratedOriginDetails', () => {
  const job: GenerationJobDetail = {
    id: 'j1',
    projectId: 'p1',
    kind: 'generate-score',
    status: 'done',
    createdAt: '2026-08-07T10:00:00.000Z',
    finishedAt: '2026-08-07T10:02:00.000Z',
    error: null,
    usage: { promptTokens: 1200, completionTokens: 300, model: 'gpt-5.4' },
    request: {
      prompt: 'a late-night electro swing number',
      style: 'electroSwing',
      mood: 'playful',
      durationMeasures: 16,
      tempo: 112,
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: { fifths: -1, mode: 'minor' },
      complexity: 'moderate',
      lyrics: true,
      lyricsTheme: 'a night bus home',
      tracks: [
        { name: 'Clarinet', instrumentName: 'Clarinet', midiProgram: 71, clef: 'treble' },
        { name: 'Bass', instrumentName: 'Acoustic Bass', midiProgram: 32, clef: 'bass' },
      ],
    },
  };

  it('shows the request as readable rows, then the job', () => {
    render(<GeneratedOriginDetails job={job} />);
    expect(screen.getByText('a late-night electro swing number')).toBeTruthy();
    // A style reads by its translated name, never its id.
    expect(screen.getByText('Electro Swing')).toBeTruthy();
    expect(screen.queryByText('electroSwing')).toBeNull();
    expect(screen.getByText('112 BPM')).toBeTruthy();
    expect(screen.getByText('D minor')).toBeTruthy();
    expect(screen.getByText('4/4')).toBeTruthy();
    expect(screen.getByText('16 bars')).toBeTruthy();
    // The lineup as "name — instrument", one part a line; a part named after
    // its instrument is not repeated.
    expect(screen.getByText(/^Clarinet\s*Bass — Acoustic Bass$/)).toBeTruthy();
    expect(screen.getByText('a night bus home')).toBeTruthy();
    expect(screen.getByText('Moderate')).toBeTruthy();
    expect(screen.getByText('Open AI')).toBeTruthy();
    expect(screen.getByText('gpt-5.4')).toBeTruthy();
    expect(screen.getByText('1200 in, 300 out')).toBeTruthy();
    expect(screen.getByText(new Date(job.finishedAt!).toLocaleString())).toBeTruthy();
  });

  it('leaves out what the request did not say, and the usage a job never recorded', () => {
    const bare: GenerationJobDetail = { ...job };
    delete bare.usage;
    render(
      <GeneratedOriginDetails
        job={{ ...bare, request: { prompt: 'p', durationMeasures: 8, tracks: [] } }}
      />,
    );
    expect(screen.getByText('8 bars')).toBeTruthy();
    expect(screen.queryByText('Style:')).toBeNull();
    expect(screen.queryByText('Tokens:')).toBeNull();
  });
});
