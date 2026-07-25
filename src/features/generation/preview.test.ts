import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '@sudobility/music_lib';
import { extractFragment } from '@sudobility/music_lib';
import { previewStartTick, scoreWithCandidate, summarizeFragment } from '@/features/generation/preview';

describe('scoreWithCandidate', () => {
  it('splices the fragment into a new score without mutating the original', () => {
    const score = createEmptyScore({ title: 'S', measures: 2, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const measureTicks = track.measures[0].durationTicks;
    const range = { startTick: 0, endTick: measureTicks, trackIds: [track.id] };
    const fragment = extractFragment(score, range);

    const previewed = scoreWithCandidate(score, fragment);

    expect(previewed).not.toBe(score);
    expect(previewed.tracks[0].measures).toHaveLength(2);
    // The original score object is referentially unchanged (spec §37.9).
    expect(score.tracks[0].measures).toHaveLength(2);
    expect(score.tracks[0].measures[0]).toBe(track.measures[0]);
  });
});

describe('summarizeFragment', () => {
  it('counts notes and reports the pitch range, ignoring rests', () => {
    const score = createEmptyScore({ title: 'S', measures: 1, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const measure = track.measures[0];
    const voiceId = measure.voices[0].id;
    const fragment = {
      range: { startTick: 0, endTick: measure.durationTicks, trackIds: [track.id] },
      ppq: score.ppq,
      tracks: [
        {
          trackId: track.id,
          measures: [
            {
              ...measure,
              voices: [
                {
                  id: voiceId,
                  name: 'Voice 1',
                  events: [
                    {
                      id: 'n1',
                      pitch: { step: 'C' as const, accidental: 0 as const, octave: 3 },
                      startTick: 0,
                      durationTicks: 120,
                      velocity: 80,
                      voiceId,
                      trackId: track.id,
                    },
                    {
                      id: 'n2',
                      pitch: { step: 'G' as const, accidental: 0 as const, octave: 5 },
                      startTick: 120,
                      durationTicks: 120,
                      velocity: 80,
                      voiceId,
                      trackId: track.id,
                    },
                    { id: 'r1', startTick: 240, durationTicks: 240, voiceId, trackId: track.id },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const summary = summarizeFragment(fragment);

    expect(summary.noteCount).toBe(2);
    expect(summary.pitchRangeLabel).toBe('C3–G5');
  });

  it('returns a null pitch range for a fragment with no notes', () => {
    const score = createEmptyScore({ title: 'S', measures: 1, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const fragment = extractFragment(score, {
      startTick: 0,
      endTick: track.measures[0].durationTicks,
      trackIds: [track.id],
    });

    const summary = summarizeFragment(fragment);

    expect(summary.noteCount).toBe(0);
    expect(summary.pitchRangeLabel).toBeNull();
  });
});

describe('previewStartTick', () => {
  it('is the start of the fragment range', () => {
    const fragment = { range: { startTick: 960, endTick: 1920, trackIds: [] }, ppq: 480, tracks: [] };
    expect(previewStartTick(fragment)).toBe(960);
  });
});
