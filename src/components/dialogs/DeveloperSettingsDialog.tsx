/**
 * Developer settings dialog (spec §33), reachable only when
 * `ui-slice.developerMode` is on: per-overlay debug toggles, clearing
 * locally-stored device preferences, generating a stress-test score, and
 * exporting a diagnostic JSON dump. (The mock-seed control and local
 * project database died with the Phase-2 move to server-side AI/storage.)
 *
 * Adopts `@sudobility/components` controls (library sweep 2): every button
 * becomes the library `Button`, and `DevToggle` becomes a thin wrapper
 * around the library `Checkbox` -- each toggle's aria-label already
 * equalled its visible label text (unlike `GenerationPanel`'s
 * instrumentation checklist), so `Checkbox`'s `label` prop reproduces the
 * exact same accessible name with no visible-text change.
 */
import { useState } from 'react';
import { Button, Checkbox, Dialog, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
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
    <div className="py-1">
      <Checkbox label={label} checked={checked} onChange={onChange} />
    </div>
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
          <Button type="button" variant="outline" aria-label="Generate stress-test score" onClick={handleGenerateStressTest} className="px-3 py-1.5">
            Generate stress-test score
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label="Run benchmark"
            onClick={handleRunBenchmark}
            disabled={benchmarkRunning}
            className="px-3 py-1.5"
          >
            {benchmarkRunning ? 'Running benchmark…' : 'Run benchmark'}
          </Button>
          <Button type="button" variant="outline" aria-label="Export diagnostic JSON" onClick={handleExportDiagnostics} className="px-3 py-1.5">
            Export diagnostic JSON
          </Button>
          {/* `variant="ghost"` + an explicit className override, not
              `variant="destructive-outline"`: that CVA enum value has no
              matching `@sudobility/design` `v.button['destructive-outline']`
              entry, so `Button` would silently fall back to its
              `primary.default()` skin (see `button.tsx`'s `getButtonClass`)
              -- a real, wrong-looking regression for a destructive action. */}
          <Button
            type="button"
            variant="ghost"
            aria-label="Reset local database"
            onClick={() => setConfirmingReset(true)}
            className={cn(variants.button.destructive.outline(), 'border-transparent px-3 py-1.5')}
          >
            Reset local database
          </Button>
        </div>

        {benchmarkReport && (
          <div role="status" className="mt-4 flex items-start justify-between gap-3 rounded-md bg-theme-bg-secondary px-3 py-2 text-sm text-theme-text-primary">
            <span>
              Benchmark complete: {benchmarkReport.sizes.length} size(s) timed (validate/quantize/fragment/MIDI-export
              {typeof document !== 'undefined' ? '/render' : ''}). Full results logged to the console and included in
              the diagnostic JSON export.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Dismiss benchmark result"
              onClick={() => setBenchmarkReport(null)}
              className="h-auto w-auto shrink-0 p-1"
            >
              &times;
            </Button>
          </div>
        )}

        {resetDone && (
          <div role="status" className="mt-4 flex items-start justify-between gap-3 rounded-md bg-green-600/10 px-3 py-2 text-sm text-green-700">
            <span>Local database cleared. Reload the app to start fresh.</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Dismiss reset confirmation"
              onClick={() => setResetDone(false)}
              className="h-auto w-auto shrink-0 p-1"
            >
              &times;
            </Button>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
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
