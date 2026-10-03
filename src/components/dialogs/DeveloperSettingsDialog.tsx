/**
 * Developer settings dialog (spec §33), reachable only when
 * `developerMode` (music_lib's device-prefs slice) is on: which backend
 * generation is asked from, clearing locally-stored device preferences,
 * generating a stress-test score, and exporting a diagnostic JSON dump. (The
 * mock-seed control and local project database died with the Phase-2 move to
 * server-side AI/storage.)
 *
 * **The six overlay toggles are gone.** `showIds`, `showTicks`,
 * `showMeasureBoundaries`, `showPlaybackScheduling`, `enableDiagnostics` and
 * `enableValidationWarnings` were drawn here and in the native app, and no
 * package in the family ever read one of them — so a developer could switch six
 * settings and watch nothing change, which reads as a broken feature rather than
 * an absent one. What is left is `generationVariant`, which this app actually
 * sends with a generation request, plus the four actions below.
 *
 * Adopts `@sudobility/components` controls (library sweep 2): every button
 * becomes the library `Button`.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  FormModal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@sudobility/components';
import { variants } from '@sudobility/design';
import { createEmptyScore } from '@/app-library';
import type { Clef } from '@sudobility/music_types';
import { GENERATION_VARIANTS, GENERATION_VARIANT_LABELS } from '@sudobility/music_types';
import { LEGACY_FONT_SIZE_KEY, PREFS_KEY, reportError } from '@/app-library';
import { useAppStore } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { PendingButton } from '@/components/controls/PendingButton';
import { getAppServices } from '@/config/initialize';
import { runBenchmark, toBenchmarkTable } from '@/app-library';
import type { BenchmarkReport, BenchmarkSize } from '@/app-library';

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

export function DeveloperSettingsDialog({
  open,
  onClose,
  store = useAppStore,
  benchmarkSizes,
}: DeveloperSettingsDialogProps) {
  const { t } = useTranslation();
  const devSettings = store((s) => s.devSettings);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [benchmarkReport, setBenchmarkReport] = useState<BenchmarkReport | null>(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);

  const handleResetDatabase = async (): Promise<void> => {
    setConfirmingReset(false);
    try {
      // The key is music_lib's, which owns the prefs format; a copy of the
      // string here would stop clearing anything the day that one moved. The
      // font size's old key goes too, or `loadPrefs` would read it back as a
      // fallback and the reset would leave that one preference standing.
      window.localStorage.removeItem(PREFS_KEY);
      window.localStorage.removeItem(LEGACY_FONT_SIZE_KEY);
      setResetDone(true);
    } catch (error) {
      reportError(error, { context: t('errors.resetDatabase'), store });
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
    void getAppServices().io.fileExporter.save(
      'scoresmith-diagnostics.json',
      JSON.stringify(diagnostics, null, 2),
      'application/json',
    );
  };

  return (
    <>
      <FormModal
        open={open}
        title={t('devSettings.title')}
        onClose={onClose}
        size="small"
        closeAriaLabel={t('common.close')}
        // Every setting here applies on change, so there is nothing to confirm
        // and the top-bar close is the only exit -- a footer "Close" beside it
        // would just be a second control with the same name.
        actions={[]}
      >
        <div className="flex flex-col">
          {/*
            Which backend generation is asked from.

            A developer setting rather than a control in the Generate dialog:
            the answer is the same for every generation until somebody is
            deliberately comparing two of them, and asking every user to pick a
            model is asking a question they have no basis to answer. The labels
            come from music_types so the picker and the server cannot disagree
            about what is on offer; the server resolves the value through its
            own allow-list and falls back to the default, so a stale choice
            stored here is harmless.
          */}
          <div className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm text-foreground">{t('devSettings.generationBackend')}</span>
            <Select
              value={devSettings.generationVariant}
              onValueChange={(v) => store.getState().setDevSettings({ generationVariant: v })}
            >
              <SelectTrigger aria-label={t('devSettings.generationBackend')} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENERATION_VARIANTS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {GENERATION_VARIANT_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            aria-label={t('devSettings.stressTest')}
            onClick={handleGenerateStressTest}
            className="px-3 py-1.5"
          >
            {t('devSettings.stressTest')}
          </Button>
          <PendingButton
            type="button"
            variant="outline"
            aria-label={t('devSettings.runBenchmark')}
            onClick={handleRunBenchmark}
            pending={benchmarkRunning}
            pendingLabel="Running benchmark…"
            className="px-3 py-1.5"
          >
            Run benchmark
          </PendingButton>
          <Button
            type="button"
            variant="outline"
            aria-label={t('devSettings.exportDiagnostics')}
            onClick={handleExportDiagnostics}
            className="px-3 py-1.5"
          >
            {t('devSettings.exportDiagnostics')}
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
            aria-label={t('devSettings.resetDatabase')}
            onClick={() => setConfirmingReset(true)}
            className={cn(variants.button.destructive.outline(), 'border-transparent px-3 py-1.5')}
          >
            {t('devSettings.resetDatabase')}
          </Button>
        </div>

        {benchmarkReport && (
          <div
            role="status"
            className="mt-4 flex items-start justify-between gap-3 rounded-md bg-muted px-3 py-2 text-sm text-foreground"
          >
            <span>
              Benchmark complete: {benchmarkReport.sizes.length} size(s) timed
              (validate/quantize/fragment/MIDI-export
              {typeof document !== 'undefined' ? '/render' : ''}). Full results logged to the
              console and included in the diagnostic JSON export.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('devSettings.dismissBenchmark')}
              onClick={() => setBenchmarkReport(null)}
              className="h-auto w-auto shrink-0 p-1"
            >
              &times;
            </Button>
          </div>
        )}

        {resetDone && (
          <div
            role="status"
            className="mt-4 flex items-start justify-between gap-3 rounded-md bg-success/10 px-3 py-2 text-sm text-success"
          >
            <span>{t('devSettings.databaseCleared')}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('devSettings.dismissReset')}
              onClick={() => setResetDone(false)}
              className="h-auto w-auto shrink-0 p-1"
            >
              &times;
            </Button>
          </div>
        )}
      </FormModal>

      <ConfirmDialog
        open={confirmingReset}
        title={t('devSettings.resetDatabase')}
        message={t('devSettings.resetMessage')}
        confirmLabel={t('devSettings.reset')}
        onCancel={() => setConfirmingReset(false)}
        onConfirm={() => void handleResetDatabase()}
      />
    </>
  );
}
