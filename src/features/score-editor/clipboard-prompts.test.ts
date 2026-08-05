import { describe, expect, it } from 'vitest';
import { addNoteCommand, allNotes, createEmptyScore } from '@sudobility/music_lib';
import type { NoteEvent, Pitch, Score } from '@sudobility/music_types';
import {
  clipboardSpan,
  cutNeedsPrompt,
  pasteNeedsPrompt,
} from '@/features/score-editor/clipboard-prompts';

const pitch = (step: string): Pitch => ({ step, accidental: 0, octave: 4 }) as unknown as Pitch;

/** Two tracks; track 0 carries four quarter notes in its first measure. */
function melodyScore(): Score {
  let score = createEmptyScore({
    title: 'Prompt',
    measures: 2,
    tracks: [
      { name: 'A', instrumentName: 'Piano', clef: 'treble' as const },
      { name: 'B', instrumentName: 'Piano', clef: 'bass' as const },
    ],
  });
  const track = score.tracks[0];
  ['C', 'D', 'E', 'F'].forEach((step, i) => {
    score = addNoteCommand({
      trackId: track.id,
      measureId: track.measures[0].id,
      voiceIndex: 0,
      pitch: pitch(step),
      startTick: i * score.ppq,
      durationTicks: score.ppq,
    }).execute(score);
  });
  return score;
}

const onTrack0 = (score: Score) =>
  allNotes(score)
    .filter((n) => n.trackId === score.tracks[0].id)
    .sort((a, b) => a.startTick - b.startTick);

describe('cutNeedsPrompt', () => {
  it('asks when notes follow the cut', () => {
    const score = melodyScore();
    expect(cutNeedsPrompt(score, [onTrack0(score)[1]])).toBe(true);
  });

  it('does not ask when nothing follows', () => {
    // Closing the gap would move nothing, so both answers are the same score.
    const score = melodyScore();
    const notes = onTrack0(score);
    expect(cutNeedsPrompt(score, [notes[notes.length - 1]])).toBe(false);
  });

  it('does not ask for an empty selection', () => {
    expect(cutNeedsPrompt(melodyScore(), [])).toBe(false);
  });

  it('does not ask when the cut spans several tracks', () => {
    // Sliding one track up while the others stay is a desynchronisation the
    // user did not ask for; doing it to several at once is worse.
    const score = melodyScore();
    const first = onTrack0(score)[0];
    const other = { ...first, id: 'x', trackId: score.tracks[1].id } as NoteEvent;
    expect(cutNeedsPrompt(score, [first, other])).toBe(false);
  });

  it('ignores the notes being cut when looking for what follows', () => {
    // Cutting the whole track leaves nothing behind it, so there is no gap
    // worth closing even though the cut itself is large.
    const score = melodyScore();
    expect(cutNeedsPrompt(score, onTrack0(score))).toBe(false);
  });
});

describe('pasteNeedsPrompt', () => {
  it('asks when the target span already holds notes', () => {
    const score = melodyScore();
    expect(pasteNeedsPrompt(score, score.tracks[0].id, 0, score.ppq)).toBe(true);
  });

  it('does not ask when pasting into empty time', () => {
    const score = melodyScore();
    // The second measure is untouched.
    const emptyTick = score.tracks[0].measures[1].startTick;
    expect(pasteNeedsPrompt(score, score.tracks[0].id, emptyTick, score.ppq)).toBe(false);
  });

  it('does not ask about a track with nothing on it', () => {
    const score = melodyScore();
    expect(pasteNeedsPrompt(score, score.tracks[1].id, 0, score.ppq)).toBe(false);
  });

  it('does not ask for an unknown track', () => {
    expect(pasteNeedsPrompt(melodyScore(), 'nope', 0, 480)).toBe(false);
  });
});

describe('clipboardSpan', () => {
  it('measures from the earliest start to the latest end', () => {
    const score = melodyScore();
    const notes = onTrack0(score).slice(0, 3);
    expect(clipboardSpan(notes)).toBe(score.ppq * 3);
  });

  it('is zero for an empty clipboard', () => {
    expect(clipboardSpan([])).toBe(0);
  });

  it('measures a chord as one note long, not three', () => {
    const score = melodyScore();
    const one = onTrack0(score)[0];
    const chord = [one, { ...one, id: 'b' }, { ...one, id: 'c' }] as NoteEvent[];
    expect(clipboardSpan(chord)).toBe(score.ppq);
  });
});
