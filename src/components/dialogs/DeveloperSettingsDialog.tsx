/**
 * Developer settings dialog (spec §33), reachable only when
 * `ui-slice.developerMode` is on: mock-provider seed, per-overlay debug
 * toggles, reset local database, generate a stress-test score, and export
 * a diagnostic JSON dump.
 */
import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { createEmptyScore } from '@sudobility/music_lib';
import type { Clef } from '@sudobility/music_types';
import { downloadBlob } from '@sudobility/music_lib';
import { reportError } from '@sudobility/music_lib';
import type { ScoreSmithDb } from '@sudobility/music_lib';
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
  db: ScoreSmithDb;
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

export function DeveloperSettingsDialog({
  open,
  onClose,
  store = useAppStore,
  db,
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
      await db.projects.clear();
      await db.settings.clear();
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
    <Dialog open={open} onClose={onClose} aria-labelledby="dev-settings-title" maxWidth="sm" fullWidth>
      <DialogTitle id="dev-settings-title">Developer settings</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <TextField
            size="small"
            label="Mock-provider seed"
            value={devSettings.seed}
            onChange={(e) => store.getState().setDevSettings({ seed: e.target.value })}
            slotProps={{ htmlInput: { 'aria-label': 'Mock-provider seed' } }}
          />

          <Stack>
            <FormControlLabel
              control={
                <Checkbox
                  checked={devSettings.enableDiagnostics}
                  onChange={(e) => store.getState().setDevSettings({ enableDiagnostics: e.target.checked })}
                  slotProps={{ input: { 'aria-label': 'Enable generation diagnostics' } }}
                />
              }
              label="Enable generation diagnostics"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={devSettings.showIds}
                  onChange={(e) => store.getState().setDevSettings({ showIds: e.target.checked })}
                  slotProps={{ input: { 'aria-label': 'Show score IDs' } }}
                />
              }
              label="Show score IDs"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={devSettings.showTicks}
                  onChange={(e) => store.getState().setDevSettings({ showTicks: e.target.checked })}
                  slotProps={{ input: { 'aria-label': 'Show tick positions' } }}
                />
              }
              label="Show tick positions"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={devSettings.showMeasureBoundaries}
                  onChange={(e) => store.getState().setDevSettings({ showMeasureBoundaries: e.target.checked })}
                  slotProps={{ input: { 'aria-label': 'Show measure boundaries' } }}
                />
              }
              label="Show measure boundaries"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={devSettings.showPlaybackScheduling}
                  onChange={(e) => store.getState().setDevSettings({ showPlaybackScheduling: e.target.checked })}
                  slotProps={{ input: { 'aria-label': 'Show playback scheduling data' } }}
                />
              }
              label="Show playback scheduling data"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={devSettings.enableValidationWarnings}
                  onChange={(e) => store.getState().setDevSettings({ enableValidationWarnings: e.target.checked })}
                  slotProps={{ input: { 'aria-label': 'Enable validation warnings' } }}
                />
              }
              label="Enable validation warnings"
            />
          </Stack>

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button size="small" aria-label="Generate stress-test score" onClick={handleGenerateStressTest}>
              Generate stress-test score
            </Button>
            <Button
              size="small"
              aria-label="Run benchmark"
              onClick={handleRunBenchmark}
              disabled={benchmarkRunning}
            >
              {benchmarkRunning ? 'Running benchmark…' : 'Run benchmark'}
            </Button>
            <Button size="small" aria-label="Export diagnostic JSON" onClick={handleExportDiagnostics}>
              Export diagnostic JSON
            </Button>
            <Button size="small" color="error" aria-label="Reset local database" onClick={() => setConfirmingReset(true)}>
              Reset local database
            </Button>
          </Stack>

          {benchmarkReport && (
            <Alert severity="info" onClose={() => setBenchmarkReport(null)}>
              Benchmark complete: {benchmarkReport.sizes.length} size(s) timed (validate/quantize/fragment/MIDI-export
              {typeof document !== 'undefined' ? '/render' : ''}). Full results logged to the console and included in
              the diagnostic JSON export.
            </Alert>
          )}

          {resetDone && (
            <Alert severity="success" onClose={() => setResetDone(false)}>
              Local database cleared. Reload the app to start fresh.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

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
