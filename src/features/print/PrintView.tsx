/**
 * The print view: the score laid out for paper, with the controls that choose
 * what goes on it.
 *
 * A route of its own rather than an overlay, because printing prints the whole
 * document — mounting only this is simpler than hiding the editor's chrome
 * with print rules.
 */
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select, SelectContent, SelectItem, SelectTrigger } from '@sudobility/components';
import { PendingButton } from '@/components/controls/PendingButton';
import { PAGE_MARGIN_MM, selectVisibleTrackIds } from '@/app-library';
import { findTrack } from '@/app-library';
import type { PaperOrientation, PaperSize } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { WHOLE_SCORE, printPlan } from '@sudobility/music_drawing';
import { ORIENTATION_OPTIONS, PAPER_OPTIONS, defaultPaperSizeFor } from '@sudobility/music_types';
import { PrintSystem } from '@/features/print/PrintSystem';
import '@/features/print/print.css';

export type PrintViewProps = {
  store: EditorStoreApi;
  onBack: () => void;
};

export function PrintView({ store, onBack }: PrintViewProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const visibleTrackIds = store(selectVisibleTrackIds);
  const [scope, setScope] = useState<string>(WHOLE_SCORE);
  /*
    The paper is remembered (the `paperSize` device pref), because a reader's
    printer does not change between printouts; until they choose one it
    follows the browser's region — Letter where the region prints on Letter,
    A4 elsewhere. Scope and orientation are about this printout, so they are
    held here.
  */
  const chosenPaper = store((s) => s.paperSize);
  const [regionPaper] = useState(() =>
    defaultPaperSizeFor(typeof navigator === 'undefined' ? [] : navigator.languages),
  );
  const paper = chosenPaper ?? regionPaper;
  const setPaper = (value: PaperSize) => store.getState().setPaperSize(value);
  const [orientation, setOrientation] = useState<PaperOrientation>('portrait');

  /**
   * Everything that decides what reaches paper — which score (a part written
   * for its instrument, or the marked full score in concert pitch), which
   * tracks, which systems go on which page and for whose page turns — is
   * music_drawing's `printPlan`, because the native app prints the same
   * document. This view only picks the options and draws the slices.
   *
   * The plan draws through `displayScore`, so a note under an `8va` prints
   * where it is written. This view drew the stored score before, and printed a
   * bracketed passage an octave high under its own bracket.
   */
  const plan = useMemo(
    () => (score ? printPlan(score, { scope, visibleTrackIds, paper, orientation }) : null),
    [score, scope, visibleTrackIds, paper, orientation],
  );
  // `PrintSystem` takes a mutable array; the plan's is read-only by contract.
  const trackIds = useMemo(() => (plan ? [...plan.trackIds] : []), [plan]);

  /*
    Print waits for the pages. Every system is drawn into its own canvas after
    the view commits, and a long score is seconds of VexFlow — so pressing
    Print before the last canvas has been drawn sent blank systems to paper,
    with nothing on screen to say the pages were not ready. The button spins,
    and refuses a press, until every system of the current plan has reported
    itself drawn; a new plan (another scope, paper or orientation) starts the
    count again.
  */
  const [drawn, setDrawn] = useState<{ plan: unknown; systems: ReadonlySet<number> }>({
    plan: null,
    systems: new Set(),
  });
  const onDrawn = useCallback(
    (systemIndex: number) =>
      setDrawn((previous) => {
        const systems = previous.plan === plan ? previous.systems : new Set<number>();
        if (previous.plan === plan && systems.has(systemIndex)) return previous;
        return { plan, systems: new Set(systems).add(systemIndex) };
      }),
    [plan],
  );
  const systemCount = plan
    ? plan.pages.reduce((count, page) => count + page.systemIndices.length, 0)
    : 0;
  const drawnCount = drawn.plan === plan ? drawn.systems.size : 0;
  const preparing = systemCount > 0 && drawnCount < systemCount;

  const scopeLabel =
    scope === WHOLE_SCORE
      ? t('print.wholeScore')
      : ((score ? findTrack(score, scope)?.name : null) ?? t('print.wholeScore'));
  const paperOption = PAPER_OPTIONS.find((option) => option.value === paper);
  const orientationOption = ORIENTATION_OPTIONS.find((option) => option.value === orientation);

  return (
    <div className="min-h-screen bg-white text-black">
      {/*
        The printer's page and the packer's page must be the same page. Both
        come from PAGE_MARGIN_MM and the picker below; a second margin written
        into a stylesheet is how they silently drift apart.
      */}
      <style>{`@page { size: ${paperOption?.css} ${orientation}; margin: ${PAGE_MARGIN_MM}mm; }`}</style>
      {/*
        The bar is the app's, so it takes the theme; only the paper under it
        is white. On the white wrapper a ghost button's ink is the dark
        theme's light grey, which is nearly the colour of the page.
      */}
      <div className="print-chrome flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3 text-foreground">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger aria-label={t('print.whatToPrint')} className="h-auto w-auto px-3 py-1.5">
            <span>{scopeLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={WHOLE_SCORE}>{t('print.wholeScore')}</SelectItem>
            {(score?.tracks ?? []).map((track) => (
              <SelectItem key={track.id} value={track.id}>
                {track.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={paper} onValueChange={(v) => setPaper(v as PaperSize)}>
          <SelectTrigger aria-label={t('print.paper')} className="h-auto w-auto px-3 py-1.5">
            <span>{paperOption ? t(paperOption.labelKey) : ''}</span>
          </SelectTrigger>
          <SelectContent>
            {PAPER_OPTIONS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {t(p.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={orientation} onValueChange={(v) => setOrientation(v as PaperOrientation)}>
          <SelectTrigger aria-label={t('print.orientation')} className="h-auto w-auto px-3 py-1.5">
            <span>{orientationOption ? t(orientationOption.labelKey) : ''}</span>
          </SelectTrigger>
          <SelectContent>
            {ORIENTATION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {t(o.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <PendingButton
          type="button"
          variant="primary"
          onClick={() => window.print()}
          pending={preparing}
          pendingLabel={t('print.preparing')}
        >
          {t('print.action')}
        </PendingButton>
        <Button type="button" variant="ghost" onClick={onBack}>
          {t('print.backToEditor')}
        </Button>
      </div>

      {plan && plan.pages.length > 0 ? (
        <div className="print-pages mx-auto max-w-[1000px] px-4 py-6">
          {plan.pages.map((page, pageIndex) => (
            <div key={pageIndex} data-testid={`print-page-${pageIndex}`} className="print-page">
              {page.systemIndices.map((systemIndex) => (
                <PrintSystem
                  key={systemIndex}
                  score={plan.score}
                  slice={plan.slices[systemIndex]}
                  trackIds={trackIds}
                  onDrawn={onDrawn}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-neutral-600">{t('print.nothingToPrint')}</p>
      )}
    </div>
  );
}
