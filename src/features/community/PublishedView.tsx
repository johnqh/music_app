/**
 * A published snapshot, viewable and playable by anyone.
 *
 * **Read-only by construction, not by a flag.** The score is drawn with the
 * print renderer, which has no interaction surface at all — there is nothing
 * here that could change the music even if somebody wanted it to.
 *
 * Its store is isolated (`createAppStore`, not the app singleton) so opening a
 * shared link never disturbs the visitor's own open project — **and so is its
 * transport.** Play used to press `playbackController`, the app-wide adapter,
 * which is bound to the app-wide store: a visitor with a project open heard
 * that project instead of the one on the page, and a signed-out visitor, whose
 * app store holds no score, heard nothing. The page now binds the player to its
 * own store with music_lib's `bindPlayer` — the same binder the app-wide
 * adapter is a shell over — and lets go of it when the page is left.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@sudobility/components';
import { bindPlayer, computeLayout, createAppStore } from '@/app-library';
import type { PlayerBinding } from '@/app-library';
import { getMusicPlayer } from '@sudobility/music_player/core';
import type { PublishedSnapshot } from '@sudobility/music_types';
import {
  getMusicPosition,
  getMusicPositionSource,
  publishedSnapshotUrl,
} from '@sudobility/music_types';
import { getAppServices } from '@/config/initialize';
import { printRenderOptions, printSystems } from '@sudobility/music_drawing';
import { PrintSystem } from '@/features/print/PrintSystem';

export function PublishedView() {
  const { t } = useTranslation();
  const { publicId = '', lang = 'en' } = useParams();
  const [snapshot, setSnapshot] = useState<PublishedSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const store = useMemo(() => {
    const { musicClient, auth, prefsStorage } = getAppServices();
    return createAppStore({
      context: { client: musicClient, getToken: () => auth.getToken(), storage: prefsStorage },
    });
  }, []);

  const playing = store((s) => s.state === 'playing');

  /**
   * The page's own transport. Bound for as long as the page is mounted; the
   * score is loaded on the first Play gesture so Safari can unlock its audio
   * context. Stopped on the way out — a visitor who leaves the page should not
   * go on hearing it.
   *
   * The playhead is shared with the editor, and this page takes it: adopting
   * the published score starts it at the top (so the page's Play begins at the
   * beginning), and its own playback and stop move it further. So the editor's
   * caret is remembered before any of that and put back last, or following a
   * published link would cost the reader their place in their own project.
   * Remembered here rather than by adopting with `resetPosition: false`: that
   * would keep the page from moving the caret on arrival, but not its Play,
   * which moves the one playhead wherever the editor's caret was.
   */
  const [binding, setBinding] = useState<PlayerBinding | null>(null);
  useEffect(() => {
    const editorCaret = getMusicPosition().tick;
    const player = getMusicPlayer();
    const bound = bindPlayer(player, store, {
      deferUntilPlay: false,
    });
    setBinding(bound);
    return () => {
      bound.stop();
      bound.unbind();
      // Last: the stop above homes the playhead too. The player follows the
      // move, and reloading the editor's score later keeps it.
      getMusicPositionSource().moveTo(editorCaret);
    };
  }, [store]);

  useEffect(() => {
    let cancelled = false;
    getAppServices()
      .musicClient.getPublishedSnapshot(publicId)
      .then((found) => {
        if (cancelled) return;
        setSnapshot(found);
        store.getState().setScore(found.score);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [publicId, store]);

  const layout = useMemo(
    () => (snapshot ? computeLayout(snapshot.score, printRenderOptions([])) : null),
    [snapshot],
  );

  if (failed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-xl font-semibold text-theme-text-primary">{t('published.notFound')}</h1>
        <p className="mt-2 text-sm text-theme-text-secondary">{t('published.noLongerShared')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-300 px-4 py-3">
        <span className="font-medium">{snapshot?.publicName ?? t('common.loading')}</span>
        {snapshot && (
          <span className="text-sm text-neutral-600">
            {t('community.sharedBy', { name: snapshot.publisherName })}
          </span>
        )}
        <Button
          type="button"
          variant="primary"
          disabled={!snapshot || !binding}
          onClick={() => void binding?.togglePlay()}
        >
          {playing ? t('transport.pause') : t('transport.play')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setShareOpen((v) => !v)}>
          {t('published.share')}
        </Button>
        {shareOpen && (
          <code className="rounded bg-neutral-100 px-2 py-1 text-xs">
            {publishedSnapshotUrl(window.location.origin, lang, publicId)}
          </code>
        )}
      </div>

      {snapshot && layout && (
        <div className="mx-auto max-w-[1000px] px-4 py-6">
          {printSystems(layout).map((slice) => (
            <PrintSystem
              key={slice.systemIndex}
              score={snapshot.score}
              slice={slice}
              trackIds={[]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
