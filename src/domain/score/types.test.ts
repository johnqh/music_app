import { describe, expect, it } from 'vitest';
import { isNoteEvent, isRestEvent } from '@/domain/score/types';
import type { MusicalEvent, NoteEvent, RestEvent } from '@/domain/score/types';

const note: NoteEvent = {
  id: 'note-1',
  pitch: { step: 'C', accidental: 0, octave: 4 },
  startTick: 0,
  durationTicks: 480,
  velocity: 80,
  voiceId: 'voice-1',
  trackId: 'track-1',
};

const rest: RestEvent = {
  id: 'rest-1',
  startTick: 480,
  durationTicks: 480,
  voiceId: 'voice-1',
  trackId: 'track-1',
};

describe('isNoteEvent', () => {
  it('returns true for a note event (has a pitch property)', () => {
    expect(isNoteEvent(note)).toBe(true);
  });

  it('returns false for a rest event', () => {
    expect(isNoteEvent(rest)).toBe(false);
  });

  it('narrows the type so `pitch` is accessible', () => {
    const events: MusicalEvent[] = [note, rest];
    const pitches = events.filter(isNoteEvent).map((e) => e.pitch.step);
    expect(pitches).toEqual(['C']);
  });
});

describe('isRestEvent', () => {
  it('returns true for a rest event (no pitch property)', () => {
    expect(isRestEvent(rest)).toBe(true);
  });

  it('returns false for a note event', () => {
    expect(isRestEvent(note)).toBe(false);
  });
});
