/**
 * The print view: the score laid out for paper, with the controls that choose
 * what goes on it.
 *
 * A route of its own rather than an overlay, because printing prints the whole
 * document — mounting only this is simpler than hiding the editor's chrome
 * with print rules.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select, SelectContent, SelectItem, SelectTrigger } from '@sudobility/components';
import { PAGE_MARGIN_MM, selectVisibleTrackIds } from '@/app-library';
import { findTrack } from '@/app-library';
import type { PaperOrientation, PaperSize } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { WHOLE_SCORE, printPlan } from '@sudobility/music_drawing';
import { ORIENTATION_OPTIONS, PAPER_OPTIONS } from '@sudobility/music_types';
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
  const [paper, setPaper] = useState<PaperSize>('a4');
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
      <div className="print-chrome flex flex-wrap items-center gap-3 border-b border-neutral-300 px-4 py-3">
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

        <Button type="button" variant="primary" onClick={() => window.print()}>
          {t('print.action')}
        </Button>
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
