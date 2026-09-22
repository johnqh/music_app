/**
 * A published snapshot, viewable and playable by anyone.
 *
 * **Read-only by construction, not by a flag.** The score is drawn by
 * `ScoreEditorView` itself — the same interactive canvas, playback caret and
 * track-name gutter the signed-in editor uses — with `readOnly` set, which
 * unhooks every click/drag/keyboard path that could reach `dispatchCommand`
 * and hides every control that only makes sense mid-edit (the toolbar, the
 * context menu, lyric entry, the insert/generate/go-to-bar dialogs). This
 * used to draw with the print renderer instead — visually static, and with no
 * track-name gutter at all (`printRenderOptions` turns it off to save page
 * width), which is why a reader here could not tell which track played which
 * instrument. Reusing the real editor view fixes that for free and is what
 * lets this page follow along with a moving caret rather than sitting still.
 *
 * Its store is isolated (`createAppStore`, not the app singleton) so opening a
 * shared link never disturbs the visitor's own open project — **and so is its
 * transport.** `TransportBar`'s buttons call a `controller` prop rather than
 * the app-wide `playbackController` singleton for exactly that reason: this
 * page binds the player to its own store with music_lib's `bindPlayer` (the
 * same binder the app-wide adapter is a shell over) and passes that binding
 * in, so Play here plays *this* store's score — a visitor with a project open
 * elsewhere does not suddenly hear it, and a signed-out visitor (whose
 * app-wide store holds no score at all) does not hear silence instead.
 *
 * `ScoreEditorView` takes the same treatment for a second, easier-to-miss
 * reason: its playback-follow effect only *reads* `bus`/`setSoundingRenderDelay`,
 * both store-agnostic passthroughs to the one real `IMusicPlayer` — but reading
 * them off `playbackController` still lazily constructs a whole
 * `PlaybackAdapter` bound to the real app-wide store, which throws where that
 * store was never initialized (a signed-out visitor who has never opened the
 * editor). Passing the raw player's own `bus`/`setSoundingRenderDelay`
 * sidesteps constructing that adapter at all.
 *
 * **The rest of the page is an ordinary content page**, not a workspace: it
 * renders inside the normal shell (`ScreenContainerLayout`, `router.tsx`) —
 * topbar, breadcrumbs (`useSetBreadcrumbs`, Home > this snapshot's public
 * name), footer — the same as `community`/`resources`/`docs`. It used to
 * render full-bleed outside the shell, which read as a page torn out of the
 * rest of the site. `useSetPageConfig({ scrollable: false })` is what keeps
 * the notation/transport area itself viewport-bounded with its own internal
 * scrolling (`ScoreEditorView`'s scroll box) rather than the shell's normal
 * whole-page scroll — the same override a master-detail page would use.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@sudobility/components';
import { bindPlayer, createAppStore } from '@/app-library';
import type { PlayerBinding } from '@/app-library';
import { getMusicPlayer } from '@sudobility/music_player/core';
import type { PublishedSnapshot } from '@sudobility/music_types';
import {
  getMusicPosition,
  getMusicPositionSource,
  publishedSnapshotUrl,
} from '@sudobility/music_types';
import { getAppServices } from '@/config/initialize';
import { ScoreEditorView } from '@/features/score-editor/ScoreEditorView';
import { TransportBar } from '@/components/transport/TransportBar';
import { useSetPageConfig } from '@/hooks/usePageConfig';
import { useSetBreadcrumbs } from '@/hooks/useBreadcrumbs';

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
  /**
   * The raw player's `bus`/`setSoundingRenderDelay`, for `ScoreEditorView`'s
   * playback-follow effect — see the module doc comment for why this must not
   * go through the app-wide `playbackController` singleton.
   */
  const playerController = useMemo(() => {
    const player = getMusicPlayer();
    return {
      bus: player.bus,
      setSoundingRenderDelay: (seconds: number) => player.setSoundingRenderDelay(seconds),
    };
  }, []);

  const [binding, setBinding] = useState<PlayerBinding | null>(null);
  /**
   * `binding`'s transport methods plus the raw player's `bus`, for
   * `TransportBar` — `PlayerBinding` alone has no `bus` (it is not the
   * "everything" `PlaybackAdapter` is), and `TransportBar`'s position-driven
   * readouts need one.
   */
  const transportController = useMemo(
    () => (binding ? { ...binding, bus: playerController.bus } : null),
    [binding, playerController],
  );
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

  // The notation/transport area manages its own scrolling (ScoreEditorView's
  // scroll box), the same override a master-detail page would use — the
  // shell's normal whole-page scroll would fight it otherwise.
  useSetPageConfig({ scrollable: false });
  useSetBreadcrumbs(
    snapshot
      ? [
          { label: t('breadcrumbs.home'), href: `/${lang}` },
          { label: snapshot.publicName, current: true },
        ]
      : null,
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
    // flex-1, not h-screen: the shell's content area is already
    // viewport-bounded (`scrollable: false` above), so this only needs to
    // fill whatever height that already-bounded ancestor gives it — the same
    // reasoning AppLayout's own inner rows follow.
    <div className="flex min-h-0 flex-1 flex-col bg-theme-surface-primary text-theme-text-primary">
      <div className="flex flex-wrap items-center gap-3 border-b border-theme-border px-4 py-3">
        <span className="font-medium">{snapshot?.publicName ?? t('common.loading')}</span>
        {snapshot && (
          <span className="text-sm text-theme-text-secondary">
            {t('community.sharedBy', { name: snapshot.publisherName })}
          </span>
        )}
        <div className="flex-1" />
        <Button type="button" variant="ghost" onClick={() => setShareOpen((v) => !v)}>
          {t('published.share')}
        </Button>
        {shareOpen && (
          <code className="rounded bg-theme-hover-bg px-2 py-1 text-xs">
            {publishedSnapshotUrl(window.location.origin, lang, publicId)}
          </code>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <ScoreEditorView store={store} readOnly controller={playerController} />
      </div>

      {/*
        No `keyboardCollapsed`/`onToggleKeyboard`: with neither passed,
        `TransportBar` already renders no keyboard-toggle button at all — the
        piano keyboard panel itself is simply never mounted here, so there is
        nothing for that button to show or hide.

        Gated on `binding` rather than rendered eagerly: its Play button must
        call *this page's* binding, never the app-wide singleton `TransportBar`
        falls back to, and the binding is not ready until the effect above
        runs.
      */}
      {transportController && (
        <TransportBar store={store} controller={transportController} readOnly />
      )}
    </div>
  );
}
