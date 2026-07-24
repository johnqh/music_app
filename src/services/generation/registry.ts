/**
 * Generation-provider registry (spec §11, §33): a single module-level
 * `MusicGenerationProvider` instance that the store's `generation-slice`
 * (and anything else that needs to generate/regenerate) calls through
 * `getProvider()`, rather than each call site constructing its own
 * `MockGenerationProvider`. This is what makes the developer-settings
 * "mock seed" (spec §33) actually take effect: changing it (via
 * `setMockSeed`) swaps the module-level provider for a freshly seeded one,
 * so the *next* generate/regenerate call picks it up automatically.
 *
 * `setProvider` exists so tests (and, later, a real AI backend swapped in
 * behind the same `MusicGenerationProvider` interface) can substitute a
 * different provider without reaching into this module's internals.
 */
import { MockGenerationProvider } from '@/services/generation/mock-provider';
import type { MusicGenerationProvider } from '@/services/generation/types';

let currentProvider: MusicGenerationProvider = new MockGenerationProvider();

/** The active generation provider. Defaults to an unseeded `MockGenerationProvider` until `setProvider`/`setMockSeed` is called. */
export function getProvider(): MusicGenerationProvider {
  return currentProvider;
}

/** Replaces the active provider outright (e.g. with a test double, or eventually a real AI-backed provider). */
export function setProvider(provider: MusicGenerationProvider): void {
  currentProvider = provider;
}

/** Replaces the active provider with a fresh `MockGenerationProvider` seeded from developer settings (spec §33). */
export function setMockSeed(seed: number | string): void {
  currentProvider = new MockGenerationProvider({ seed });
}

/** Resets the registry to an unseeded `MockGenerationProvider` (test teardown convenience). */
export function resetProvider(): void {
  currentProvider = new MockGenerationProvider();
}
