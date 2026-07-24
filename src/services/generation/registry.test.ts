import { afterEach, describe, expect, it } from 'vitest';
import { MockGenerationProvider } from '@/services/generation/mock-provider';
import {
  getProvider,
  resetProvider,
  setMockSeed,
  setProvider,
} from '@/services/generation/registry';

afterEach(() => {
  resetProvider();
});

describe('getProvider', () => {
  it('defaults to a MockGenerationProvider', () => {
    expect(getProvider()).toBeInstanceOf(MockGenerationProvider);
    expect(getProvider().id).toBe('mock');
  });
});

describe('setMockSeed', () => {
  it('swaps in a freshly seeded MockGenerationProvider that produces deterministic output for that seed', async () => {
    setMockSeed('registry-test-seed');
    const first = await getProvider().generateScore({
      prompt: 'test',
      durationMeasures: 2,
      tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
    });

    setMockSeed('registry-test-seed');
    const second = await getProvider().generateScore({
      prompt: 'test',
      durationMeasures: 2,
      tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
    });

    expect(second.score).toEqual(first.score);
  });

  it('changing the seed changes subsequent output', async () => {
    setMockSeed('seed-a');
    const a = await getProvider().generateScore({
      prompt: 'test',
      durationMeasures: 2,
      tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
    });

    setMockSeed('seed-b');
    const b = await getProvider().generateScore({
      prompt: 'test',
      durationMeasures: 2,
      tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
    });

    expect(b.score).not.toEqual(a.score);
  });
});

describe('setProvider', () => {
  it('replaces the active provider outright', () => {
    const fake: MockGenerationProvider = new MockGenerationProvider({ seed: 'fake' });
    setProvider(fake);
    expect(getProvider()).toBe(fake);
  });
});
