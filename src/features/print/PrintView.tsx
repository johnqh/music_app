/**
 * The print view: the score laid out for paper, with the controls that choose
 * what goes on it.
 *
 * A route of its own rather than an overlay, because printing prints the whole
 * document — mounting only this is simpler than hiding the editor's chrome
 * with print rules.
 */
import { useMemo, useState } from 'react';
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

/** Display names, and the CSS `size` keyword for each paper. */
const PAPERS: { value: PaperSize; label: string; css: string }[] = [
  { value: 'a4', label: 'A4', css: 'A4' },
  { value: 'letter', label: 'Letter', css: 'letter' },
  { value: 'legal', label: 'Legal', css: 'legal' },
];

const ORIENTATIONS: { value: PaperOrientation; label: string }[] = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

export function PrintView({ store, onBack }: PrintViewProps) {
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
          <SelectTrigger aria-label="What to print" className="h-auto w-auto px-3 py-1.5">
            <span>{scopeLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={WHOLE_SCORE}>Whole score</SelectItem>
            {(score?.tracks ?? []).map((track) => (
              <SelectItem key={track.id} value={track.id}>
                {track.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={paper} onValueChange={(v) => setPaper(v as PaperSize)}>
          <SelectTrigger aria-label="Paper" className="h-auto w-auto px-3 py-1.5">
            <span>{PAPERS.find((p) => p.value === paper)?.label}</span>
          </SelectTrigger>
          <SelectContent>
            {PAPERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={orientation} onValueChange={(v) => setOrientation(v as PaperOrientation)}>
          <SelectTrigger aria-label="Orientation" className="h-auto w-auto px-3 py-1.5">
            <span>{ORIENTATIONS.find((o) => o.value === orientation)?.label}</span>
          </SelectTrigger>
          <SelectContent>
            {ORIENTATIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button type="button" variant="primary" onClick={() => window.print()}>
          Print
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back to editor
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
        <p className="px-4 py-6 text-sm text-neutral-600">There is nothing to print yet.</p>
      )}
    </div>
  );
}
