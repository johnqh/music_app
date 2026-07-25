/**
 * Developer settings dialog (spec §33), reachable only when
 * `ui-slice.developerMode` is on: per-overlay debug toggles, clearing
 * locally-stored device preferences, generating a stress-test score, and
 * exporting a diagnostic JSON dump. (The mock-seed control and local
 * project database died with the Phase-2 move to server-side AI/storage.)
 */
import { useState } from 'react';
import { Dialog } from '@sudobility/components';
import { createEmptyScore } from '@sudobility/music_lib';
import type { Clef } from '@sudobility/music_types';
import { downloadBlob } from '@sudobility/music_lib';
import { reportError } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { runBenchmark, toBenchmarkTable } from '@sudobility/music_lib';
import type { BenchmarkReport, BenchmarkSize } from '@sudobility/music_lib';

export type DeveloperSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** The database "reset local database" clears. Required (not defaulted): the store alone has no `ScoreSmithDb` handle (see `project-slice.ts`'s doc comment). */
  /** Sizes "Run benchmark" passes to `runBenchmark`. Defaults to `runBenchmark`'s own default (up to a 20-track/500-measure score); tests override with small sizes so the (real, synchronous) benchmark run stays fast. */
  benchmarkSizes?: BenchmarkSize[];
};

/** Spec §29's stress-test dimensions ("≥20 tracks; ≥500 measures"), applied to a fresh empty (fully-rested) score -- a lighter-weight stand-in for the fuller note-filled benchmark utility Task 17 owns. */
const STRESS_TRACK_COUNT = 24;
const STRESS_MEASURE_COUNT = 520;

function generateStressTestScore() {
  const tracks = Array.from({ length: STRESS_TRACK_COUNT }, (_, i) => ({
    name: `Stress Track ${i + 1}`,
    instrumentName: 'Piano',
    clef: (i % 2 === 0 ? 'treble' : 'bass') as Clef,
  }));
  return createEmptyScore({ title: 'Stress Test', measures: STRESS_MEASURE_COUNT, tracks });
}

type DevToggleProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

function DevToggle({ label, checked, onChange }: DevToggleProps) {
  return (
    <label className="flex items-center gap-2 py-1 text-sm text-theme-text-primary">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-theme-border"
      />
      {label}
    </label>
  );
}

export function DeveloperSettingsDialog({
  open,
  onClose,
  store = useAppStore,
  benchmarkSizes,
}: DeveloperSettingsDialogProps) {
  const devSettings = store((s) => s.devSettings);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [benchmarkReport, setBenchmarkReport] = useState<BenchmarkReport | null>(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);

  const handleResetDatabase = async (): Promise<void> => {
    setConfirmingReset(false);
    try {
      window.localStorage.removeItem('scoresmith.prefs.v1');
      setResetDone(true);
    } catch (error) {
      reportError(error, { context: 'Failed to reset the local database', store });
    }
  };

  const handleGenerateStressTest = (): void => {
    store.getState().setScore(generateStressTestScore());
  };

  /**
   * Runs the spec §29 benchmark suite (`services/perf/benchmark.ts`) and
   * logs it as a `console.table` (per the Task 17 brief). Deferred one
   * macrotask via `setTimeout` so the "Running benchmark…" button label
   * actually paints before the synchronous, CPU-bound run blocks the main
   * thread — `runBenchmark`'s default sizes go up to a 20-track/500-measure
   * (~40,000-note) score and can take real time.
   */
  const handleRunBenchmark = (): void => {
    setBenchmarkRunning(true);
    setTimeout(() => {
      try {
        const report = runBenchmark(benchmarkSizes);
        setBenchmarkReport(report);
        console.table(toBenchmarkTable(report));
      } finally {
        setBenchmarkRunning(false);
      }
    }, 0);
  };

  const handleExportDiagnostics = (): void => {
    const state = store.getState();
    const diagnostics = {
      exportedAt: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      devSettings: state.devSettings,
      projectId: state.projectId,
      projectName: state.projectName,
      score: state.score
        ? {
            id: state.score.id,
            title: state.score.metadata.title,
            trackCount: state.score.tracks.length,
            measureCount: state.score.tracks[0]?.measures.length ?? 0,
          }
        : null,
      validationIssues: state.validationIssues,
      // `null` unless "Run benchmark" was clicked at least once this
      // session (spec §29: fold the benchmark utility's output into the
      // diagnostic export, alongside the existing console.table).
      benchmark: benchmarkReport,
    };
    downloadBlob('scoresmith-diagnostics.json', new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' }));
  };

  return (
    <Dialog isOpen={open} onClose={onClose} size="sm" showCloseButton={false}>
      <div role="dialog" aria-labelledby="dev-settings-title" className="p-6">
        <h2 id="dev-settings-title" className="text-lg font-semibold text-theme-text-primary">
          Developer settings
        </h2>

        <div className="mt-4 flex flex-col">
          <DevToggle
            label="Enable generation diagnostics"
            checked={devSettings.enableDiagnostics}
            onChange={(checked) => store.getState().setDevSettings({ enableDiagnostics: checked })}
          />
          <DevToggle
            label="Show score IDs"
            checked={devSettings.showIds}
            onChange={(checked) => store.getState().setDevSettings({ showIds: checked })}
          />
          <DevToggle
            label="Show tick positions"
            checked={devSettings.showTicks}
            onChange={(checked) => store.getState().setDevSettings({ showTicks: checked })}
          />
          <DevToggle
            label="Show measure boundaries"
            checked={devSettings.showMeasureBoundaries}
            onChange={(checked) => store.getState().setDevSettings({ showMeasureBoundaries: checked })}
          />
          <DevToggle
            label="Show playback scheduling data"
            checked={devSettings.showPlaybackScheduling}
            onChange={(checked) => store.getState().setDevSettings({ showPlaybackScheduling: checked })}
          />
          <DevToggle
            label="Enable validation warnings"
            checked={devSettings.enableValidationWarnings}
            onChange={(checked) => store.getState().setDevSettings({ enableValidationWarnings: checked })}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            aria-label="Generate stress-test score"
            onClick={handleGenerateStressTest}
            className="rounded-md border border-theme-border px-3 py-1.5 text-sm text-theme-text-primary hover:bg-theme-hover-bg"
          >
            Generate stress-test score
          </button>
          <button
            type="button"
            aria-label="Run benchmark"
            onClick={handleRunBenchmark}
            disabled={benchmarkRunning}
            className="rounded-md border border-theme-border px-3 py-1.5 text-sm text-theme-text-primary hover:bg-theme-hover-bg disabled:opacity-50"
          >
            {benchmarkRunning ? 'Running benchmark…' : 'Run benchmark'}
          </button>
          <button
            type="button"
            aria-label="Export diagnostic JSON"
            onClick={handleExportDiagnostics}
            className="rounded-md border border-theme-border px-3 py-1.5 text-sm text-theme-text-primary hover:bg-theme-hover-bg"
          >
            Export diagnostic JSON
          </button>
          <button
            type="button"
            aria-label="Reset local database"
            onClick={() => setConfirmingReset(true)}
            className="rounded-md border border-red-600 px-3 py-1.5 text-sm text-red-600 hover:bg-red-600/10"
          >
            Reset local database
          </button>
        </div>

        {benchmarkReport && (
          <div role="status" className="mt-4 flex items-start justify-between gap-3 rounded-md bg-theme-bg-secondary px-3 py-2 text-sm text-theme-text-primary">
            <span>
              Benchmark complete: {benchmarkReport.sizes.length} size(s) timed (validate/quantize/fragment/MIDI-export
              {typeof document !== 'undefined' ? '/render' : ''}). Full results logged to the console and included in
              the diagnostic JSON export.
            </span>
            <button
              type="button"
              aria-label="Dismiss benchmark result"
              onClick={() => setBenchmarkReport(null)}
              className="shrink-0 rounded p-1 hover:bg-theme-hover-bg"
            >
              &times;
            </button>
          </div>
        )}

        {resetDone && (
          <div role="status" className="mt-4 flex items-start justify-between gap-3 rounded-md bg-green-600/10 px-3 py-2 text-sm text-green-700">
            <span>Local database cleared. Reload the app to start fresh.</span>
            <button
              type="button"
              aria-label="Dismiss reset confirmation"
              onClick={() => setResetDone(false)}
              className="shrink-0 rounded p-1 hover:bg-theme-hover-bg"
            >
              &times;
            </button>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-hover-bg"
          >
            Close
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingReset}
        title="Reset local database"
        message="This permanently deletes every saved project and setting from this browser. This cannot be undone."
        confirmLabel="Reset"
        onCancel={() => setConfirmingReset(false)}
        onConfirm={() => void handleResetDatabase()}
      />
    </Dialog>
  );
}
