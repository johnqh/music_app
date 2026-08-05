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
import { computeLayout, selectVisibleTrackIds } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { printRenderOptions, printSystems } from '@/features/print/print-layout';
import { PrintSystem } from '@/features/print/PrintSystem';
import '@/features/print/print.css';

export type PrintViewProps = {
  store: EditorStoreApi;
  onBack: () => void;
};

/** Sentinel for "everything": a Select cannot carry an empty value. */
const WHOLE_SCORE = 'whole-score';

export function PrintView({ store, onBack }: PrintViewProps) {
  const score = store((s) => s.score);
  const visibleTrackIds = store(selectVisibleTrackIds);
  const [scope, setScope] = useState<string>(WHOLE_SCORE);

  const isSingleTrack = scope !== WHOLE_SCORE;
  const trackIds = useMemo(
    () => (isSingleTrack ? [scope] : visibleTrackIds),
    [isSingleTrack, scope, visibleTrackIds],
  );

  const pages = useMemo(() => {
    if (!score) return [];
    return printSystems(computeLayout(score, printRenderOptions(trackIds)));
  }, [score, trackIds]);

  const scopeLabel = isSingleTrack
    ? (score?.tracks.find((t) => t.id === scope)?.name ?? 'Whole score')
    : 'Whole score';

  return (
    <div className="min-h-screen bg-white text-black">
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

        <Button type="button" variant="primary" onClick={() => window.print()}>
          Print
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back to editor
        </Button>

        {isSingleTrack ? (
          <p className="w-full text-sm text-neutral-600">
            Single tracks print at concert pitch, with every bar of rest written out. Fine for a
            lead sheet or a piano part; not yet an orchestral part.
          </p>
        ) : null}
      </div>

      {score && pages.length > 0 ? (
        <div className="print-pages mx-auto max-w-[1000px] px-4 py-6">
          {pages.map((page) => (
            <PrintSystem key={page.systemIndex} score={score} page={page} trackIds={trackIds} />
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-neutral-600">There is nothing to print yet.</p>
      )}
    </div>
  );
}
