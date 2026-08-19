/**
 * A published snapshot, viewable and playable by anyone.
 *
 * **Read-only by construction, not by a flag.** The score is drawn with the
 * print renderer, which has no interaction surface at all — there is no editor
 * store bound to the page, so there is nothing here that could change the
 * music even if somebody wanted it to.
 *
 * Its store is isolated (`createAppStore`, not the app singleton) so opening a
 * shared link never disturbs the visitor's own open project.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@sudobility/components';
import { computeLayout, createAppStore, playbackController } from '@sudobility/music_lib';
import type { PublishedSnapshot } from '@sudobility/music_types';
import { getAppServices } from '@/config/initialize';
import { printRenderOptions, printSystems } from '@/features/print/print-layout';
import { PrintSystem } from '@/features/print/PrintSystem';

export function PublishedView() {
  const { t } = useTranslation();
  const { publicId = '' } = useParams();
  const [snapshot, setSnapshot] = useState<PublishedSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [playing, setPlaying] = useState(false);

  const store = useMemo(() => {
    const { musicClient, auth, prefsStorage } = getAppServices();
    return createAppStore({
      context: { client: musicClient, getToken: () => auth.getToken(), storage: prefsStorage },
    });
  }, []);

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
        <span className="font-medium">{snapshot?.name ?? t('common.loading')}</span>
        {snapshot && (
          <span className="text-sm text-neutral-600">
            {t('community.sharedBy', { name: snapshot.publisherName })}
          </span>
        )}
        <Button
          type="button"
          variant="primary"
          disabled={!snapshot}
          onClick={() => {
            playbackController.togglePlay();
            setPlaying((v) => !v);
          }}
        >
          {playing ? t('player.pause') : t('player.play')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setShareOpen((v) => !v)}>
          {t('published.share')}
        </Button>
        {shareOpen && (
          <code className="rounded bg-neutral-100 px-2 py-1 text-xs">{window.location.href}</code>
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
