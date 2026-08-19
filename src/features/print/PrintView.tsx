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
import {
  computeLayout,
  extractPart,
  PAGE_MARGIN_MM,
  paginate,
  selectVisibleTrackIds,
  usablePageHeight,
  withRehearsalMarks,
} from '@sudobility/music_lib';
import type { PaperOrientation, PaperSize } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { PRINT_WIDTH, printRenderOptions, printSystems } from '@/features/print/print-layout';
import { PrintSystem } from '@/features/print/PrintSystem';
import '@/features/print/print.css';

export type PrintViewProps = {
  store: EditorStoreApi;
  onBack: () => void;
};

/** Sentinel for "everything": a Select cannot carry an empty value. */
const WHOLE_SCORE = 'whole-score';

/**
 * Paper sizes and orientations, with the CSS `size` keyword for each paper.
 *
 * `A4` stays a literal: it is an ISO designation, not a word. The other two are
 * translated — "Letter" and "Legal" are names a reader outside the US will not
 * recognise, and orientation is plain vocabulary.
 */
const PAPERS: { value: PaperSize; label?: string; labelKey?: string; css: string }[] = [
  { value: 'a4', label: 'A4', css: 'A4' },
  { value: 'letter', labelKey: 'print.paperLetter', css: 'letter' },
  { value: 'legal', labelKey: 'print.paperLegal', css: 'legal' },
];

const ORIENTATIONS: { value: PaperOrientation; labelKey: string }[] = [
  { value: 'portrait', labelKey: 'print.portrait' },
  { value: 'landscape', labelKey: 'print.landscape' },
];

export function PrintView({ store, onBack }: PrintViewProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const visibleTrackIds = store(selectVisibleTrackIds);
  const [scope, setScope] = useState<string>(WHOLE_SCORE);
  const [paper, setPaper] = useState<PaperSize>('a4');
  const [orientation, setOrientation] = useState<PaperOrientation>('portrait');

  const isSingleTrack = scope !== WHOLE_SCORE;
  const trackIds = useMemo(
    () => (isSingleTrack ? [scope] : visibleTrackIds),
    [isSingleTrack, scope, visibleTrackIds],
  );

  /**
   * The score actually printed.
   *
   * A single track goes through `extractPart`, which writes it for its
   * instrument — a clarinet part reads a tone above what it sounds, with a key
   * signature to match. The whole score does not: conductors read concert
   * pitch, and the score is the one place every part must be comparable.
   */
  const printedScore = useMemo(() => {
    if (!score) return null;
    // Marks go on both: a conductor reading the score needs the same letters
    // the players have, which is the one thing a rehearsal mark is for.
    // `extractPart` applies them itself, from the whole score.
    return isSingleTrack ? extractPart(score, scope) : withRehearsalMarks(score);
  }, [score, isSingleTrack, scope]);

  const plan = useMemo(
    () => (printedScore ? computeLayout(printedScore, printRenderOptions(trackIds)) : null),
    [printedScore, trackIds],
  );

  const slices = useMemo(() => (plan ? printSystems(plan) : []), [plan]);

  /**
   * The part's own track, when printing one — the player whose rests decide
   * where the turns go. A whole score passes nothing: some track is always
   * playing, and a conductor turns at will.
   */
  const turnTrack = isSingleTrack ? printedScore?.tracks[0] : undefined;

  const pages = useMemo(
    () =>
      plan ? paginate(plan, usablePageHeight(paper, orientation, PRINT_WIDTH), turnTrack) : [],
    [plan, paper, orientation, turnTrack],
  );

  const scopeLabel = isSingleTrack
    ? (score?.tracks.find((t) => t.id === scope)?.name ?? 'Whole score')
    : 'Whole score';

  return (
    <div className="min-h-screen bg-white text-black">
      {/*
        The printer's page and the packer's page must be the same page. Both
        come from PAGE_MARGIN_MM and the picker below; a second margin written
        into a stylesheet is how they silently drift apart.
      */}
      <style>{`@page { size: ${PAPERS.find((p) => p.value === paper)?.css} ${orientation}; margin: ${PAGE_MARGIN_MM}mm; }`}</style>
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
            <span>
              {(() => {
                const found = PAPERS.find((option) => option.value === paper);
                return found?.label ?? (found?.labelKey ? t(found.labelKey) : '');
              })()}
            </span>
          </SelectTrigger>
          <SelectContent>
            {PAPERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label ?? t(p.labelKey!)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={orientation} onValueChange={(v) => setOrientation(v as PaperOrientation)}>
          <SelectTrigger aria-label={t('print.orientation')} className="h-auto w-auto px-3 py-1.5">
            <span>
              {(() => {
                const key = ORIENTATIONS.find((o) => o.value === orientation)?.labelKey;
                return key ? t(key) : '';
              })()}
            </span>
          </SelectTrigger>
          <SelectContent>
            {ORIENTATIONS.map((o) => (
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

      {printedScore && pages.length > 0 ? (
        <div className="print-pages mx-auto max-w-[1000px] px-4 py-6">
          {pages.map((page, pageIndex) => (
            <div key={pageIndex} data-testid={`print-page-${pageIndex}`} className="print-page">
              {page.systemIndices.map((systemIndex) => (
                <PrintSystem
                  key={systemIndex}
                  score={printedScore}
                  slice={slices[systemIndex]}
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
