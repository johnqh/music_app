import type { Score, PrefsStorage } from '@sudobility/music_types';

export type ProjectLocalUiState = {
  zoom?: number;
  visibleTrackIds?: string[];
  mutedTrackIds?: string[];
  soloTrackIds?: string[];
  cursorTick?: number;
};

const KEY = 'scoresmith.project-ui.v1';

function readAll(raw: string | null): Record<string, ProjectLocalUiState> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, ProjectLocalUiState>)
      : {};
  } catch {
    return {};
  }
}

function readState(value: unknown): ProjectLocalUiState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const state: ProjectLocalUiState = {};
  if (typeof record.zoom === 'number' && Number.isFinite(record.zoom) && record.zoom > 0) {
    state.zoom = record.zoom;
  }
  if (Array.isArray(record.visibleTrackIds)) {
    state.visibleTrackIds = record.visibleTrackIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
  }
  if (Array.isArray(record.mutedTrackIds)) {
    state.mutedTrackIds = record.mutedTrackIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
  }
  if (Array.isArray(record.soloTrackIds)) {
    state.soloTrackIds = record.soloTrackIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
  }
  if (
    typeof record.cursorTick === 'number' &&
    Number.isFinite(record.cursorTick) &&
    record.cursorTick >= 0
  ) {
    state.cursorTick = record.cursorTick;
  }
  return state;
}

export async function loadProjectLocalUi(
  storage: PrefsStorage | undefined,
  projectId: string,
): Promise<ProjectLocalUiState> {
  if (!storage) return {};
  try {
    return readState(readAll((await storage.getItem(KEY)) ?? null)[projectId]);
  } catch {
    return {};
  }
}

export async function saveProjectLocalUi(
  storage: PrefsStorage | undefined,
  projectId: string,
  state: ProjectLocalUiState,
): Promise<void> {
  if (!storage) return;
  try {
    const all = readAll((await storage.getItem(KEY)) ?? null);
    all[projectId] = { ...readState(all[projectId]), ...readState(state) };
    await storage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Local preference persistence is best effort and must not affect editing.
  }
}

export function applyProjectLocalMix(score: Score, state: ProjectLocalUiState): Score {
  const muted = new Set(state.mutedTrackIds ?? []);
  const solo = new Set(state.soloTrackIds ?? []);
  return {
    ...score,
    tracks: score.tracks.map((track) => ({
      ...track,
      muted: muted.has(track.id),
      solo: solo.has(track.id),
    })),
  };
}

/**
 * Carries the mute and solo of the score on screen onto one that arrived from
 * the server, by track id.
 *
 * Mute and solo are listening preferences, not score data: the server never
 * stores them (`projectScoreForServer`), so a score read back from it — a live
 * partial, a generation's result — would silence nothing and un-solo
 * everything. The current score is the source rather than local storage
 * because it is what the reader sees now, not what was saved a moment ago.
 */
export function carryProjectLocalMix(from: Score | null, to: Score): Score {
  if (!from) return to;
  return applyProjectLocalMix(to, {
    mutedTrackIds: from.tracks.filter((track) => track.muted).map((track) => track.id),
    soloTrackIds: from.tracks.filter((track) => track.solo).map((track) => track.id),
  });
}

export function projectScoreForServer(score: Score): Score {
  return {
    ...score,
    tracks: score.tracks.map((track) => ({
      ...track,
      muted: false,
      solo: false,
    })),
  };
}
