import { describe, expect, it } from 'vitest';
import { allNotes, validateScore } from '@sudobility/music_types';
import { twinkleScore } from '@/app-library';
import type { Pitch } from '@sudobility/music_types';
import { drawLineCommand, lineNotes, reviseLine, type LineSample } from '@sudobility/music_editing';

const pitch = (step: Pitch['step'], octave = 4): Pitch => ({ step, octave, accidental: 0 });
const sample = (tick: number, note: Pitch): LineSample => ({ tick, pitch: note, x: tick, y: 0 });

describe('line drawing', () => {
  it('revises the future of a path when the pointer moves backward', () => {
    const original = [sample(0, pitch('C')), sample(120, pitch('D')), sample(240, pitch('E'))];
    expect(reviseLine(original, sample(100, pitch('G'))).map((point) => point.tick)).toEqual([
      0, 100,
    ]);
  });

  it('preserves pitch runs when they fit the stroke duration', () => {
    const score = twinkleScore();
    const track = score.tracks[0]!;
    const notes = lineNotes(
      [
        sample(0, pitch('C')),
        sample(60, pitch('C')),
        sample(120, pitch('E')),
        sample(180, pitch('E')),
        sample(240, pitch('G')),
        sample(960, pitch('G')),
      ],
      score,
      track,
    );
    expect(notes.map((note) => [note.startTick, note.endTick])).toEqual([
      [0, 240],
      [240, 480],
      [480, 960],
    ]);
  });

  it('drops rapid pitch changes rather than extending beyond the stroke', () => {
    const score = twinkleScore();
    const track = score.tracks[0]!;
    const notes = lineNotes(
      [
        sample(0, pitch('C')),
        sample(60, pitch('C')),
        sample(120, pitch('E')),
        sample(180, pitch('E')),
        sample(240, pitch('G')),
        sample(300, pitch('G')),
      ],
      score,
      track,
    );
    expect(notes.length).toBeLessThan(3);
    expect(notes[0]!.startTick).toBe(0);
    expect(notes.at(-1)!.endTick).toBe(300);
    expect(notes.every((note) => note.endTick <= 300)).toBe(true);
  });

  it('replaces just the drawn span, ties across a barline, and undoes as one command', () => {
    const score = twinkleScore();
    const track = score.tracks[0]!;
    const bar = track.measures[0]!.durationTicks;
    const command = drawLineCommand(track.id, 0, [
      { startTick: bar - 120, endTick: bar + 120, pitch: pitch('F') },
    ]);
    const edited = command.execute(score);
    const inserted = allNotes(edited).filter(
      (note) =>
        note.trackId === track.id &&
        note.pitch.step === 'F' &&
        note.startTick >= bar - 120 &&
        note.startTick < bar + 120,
    );
    expect(inserted).toHaveLength(2);
    expect(inserted[0]!.tieStart).toBe(true);
    expect(inserted[1]!.tieStop).toBe(true);
    expect(command.undo(edited)).toEqual(score);
    expect(validateScore(edited).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('preserves both sides of an existing note when drawing through its middle', () => {
    const score = twinkleScore();
    const track = score.tracks[0]!;
    const edited = drawLineCommand(track.id, 0, [
      { startTick: 120, endTick: 360, pitch: pitch('G') },
    ]).execute(score);
    const notes = allNotes(edited).filter((note) => note.startTick < 480);
    expect(notes.map((note) => [note.startTick, note.durationTicks, note.pitch.step])).toEqual([
      [0, 120, 'C'],
      [120, 240, 'G'],
      [360, 120, 'C'],
    ]);
  });

  it('keeps an existing tie on the surviving side of a replacement', () => {
    const score = twinkleScore();
    const track = score.tracks[0]!;
    const bar = track.measures[0]!.durationTicks;
    const tied = drawLineCommand(track.id, 0, [
      { startTick: bar - 120, endTick: bar + 120, pitch: pitch('F') },
    ]).execute(score);
    const edited = drawLineCommand(track.id, 0, [
      { startTick: bar - 90, endTick: bar - 30, pitch: pitch('G') },
    ]).execute(tied);
    const f = allNotes(edited).filter(
      (note) =>
        note.pitch.step === 'F' && note.startTick >= bar - 120 && note.startTick < bar + 120,
    );
    expect(f.find((note) => note.startTick === bar - 30)?.tieStart).toBe(true);
    expect(f.find((note) => note.startTick === bar)?.tieStop).toBe(true);
    expect(validateScore(edited).filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
