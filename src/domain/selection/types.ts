/**
 * Selection model types (spec §9). Shared by the sheet editor, piano roll,
 * inspector, regeneration panel, playback loop controls, copy/paste,
 * delete, and quantization.
 */

/** A tick range scoped to a set of tracks (e.g. a loop region or regeneration target). */
export type ScoreRange = { startTick: number; endTick: number; trackIds: string[] };

export type ScoreSelection = {
  eventIds: string[];
  measureIds: string[];
  trackIds: string[];
  range?: ScoreRange;
};

/** An empty selection: no events, measures, tracks, or range selected. */
export function emptySelection(): ScoreSelection {
  return { eventIds: [], measureIds: [], trackIds: [] };
}
