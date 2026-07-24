/**
 * UI slice (spec §6, §33): view mode, theme, zoom/snap, developer settings
 * (spec §33: mock seed, id/tick overlays), dialog open-state, and toasts.
 * Pure UI/app state — no domain mutation happens here (that's always
 * `score-slice.dispatchCommand`).
 */
import type { StateCreator } from 'zustand';
import { createId } from '@/domain/score/ids';
import type { DurationName } from '@/domain/score/types';
import { setMockSeed } from '@/services/generation/registry';
import type { AppState } from '@/store/useAppStore';

export type ViewMode = 'notation' | 'piano-roll';
export type ThemeMode = 'light' | 'dark' | 'system';

export type DevSettings = {
  seed: string;
  showIds: boolean;
  showTicks: boolean;
};

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';
export type Toast = { id: string; message: string; severity: ToastSeverity };

const DEFAULT_DEV_SETTINGS: DevSettings = {
  seed: 'scoresmith-mock',
  showIds: false,
  showTicks: false,
};

export type UiSlice = {
  view: ViewMode;
  themeMode: ThemeMode;
  zoom: number;
  snapGrid: DurationName;
  developerMode: boolean;
  devSettings: DevSettings;
  dialogs: Record<string, boolean>;
  toasts: Toast[];

  setView: (view: ViewMode) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setZoom: (zoom: number) => void;
  setSnapGrid: (grid: DurationName) => void;
  setDeveloperMode: (enabled: boolean) => void;
  /** Merges `patch` into `devSettings`; changing `seed` also re-seeds the generation provider registry (`services/generation/registry.ts`) so the next generate/regenerate call picks it up. */
  setDevSettings: (patch: Partial<DevSettings>) => void;
  openDialog: (id: string) => void;
  closeDialog: (id: string) => void;
  toggleDialog: (id: string) => void;
  /** Enqueues a toast and returns its generated id (so a caller can `dismissToast` it early, e.g. on an "undo" action inside the toast itself). */
  pushToast: (toast: { message: string; severity?: ToastSeverity }) => string;
  dismissToast: (id: string) => void;
};

export const createUiSlice: StateCreator<AppState, [['zustand/immer', never]], [], UiSlice> = (
  set,
) => ({
  view: 'notation',
  themeMode: 'system',
  zoom: 1,
  snapGrid: 'quarter',
  developerMode: false,
  devSettings: DEFAULT_DEV_SETTINGS,
  dialogs: {},
  toasts: [],

  setView: (view) => {
    set((state) => {
      state.view = view;
    });
  },
  setThemeMode: (mode) => {
    set((state) => {
      state.themeMode = mode;
    });
  },
  setZoom: (zoom) => {
    set((state) => {
      state.zoom = zoom;
    });
  },
  setSnapGrid: (grid) => {
    set((state) => {
      state.snapGrid = grid;
    });
  },
  setDeveloperMode: (enabled) => {
    set((state) => {
      state.developerMode = enabled;
    });
  },
  setDevSettings: (patch) => {
    if (patch.seed !== undefined) setMockSeed(patch.seed);
    set((state) => {
      Object.assign(state.devSettings, patch);
    });
  },
  openDialog: (id) => {
    set((state) => {
      state.dialogs[id] = true;
    });
  },
  closeDialog: (id) => {
    set((state) => {
      state.dialogs[id] = false;
    });
  },
  toggleDialog: (id) => {
    set((state) => {
      state.dialogs[id] = !state.dialogs[id];
    });
  },
  pushToast: (toast) => {
    const id = createId();
    set((state) => {
      state.toasts.push({ id, message: toast.message, severity: toast.severity ?? 'info' });
    });
    return id;
  },
  dismissToast: (id) => {
    set((state) => {
      state.toasts = state.toasts.filter((t) => t.id !== id);
    });
  },
});
