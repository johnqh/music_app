/**
 * The public Community list.
 *
 * Rendered **outside** the auth gate: a stranger with no account can browse it.
 * Fetched with no token, because a visitor has none. It now renders inside the
 * app shell, so a visitor who arrives here has a topbar to leave by — it used
 * to be declared outside `ScreenContainerLayout` and had no navigation at all.
 *
 * Search filters the list already fetched, on the client. That is honest at
 * this size and needs no API: `listCommunity()` returns the whole set. A
 * server-side search belongs with a `music_api` route and a plan of its own,
 * and should arrive before the list outgrows one response.
 *
 * **Tiles in a grid, as My Projects draws its projects** — the same card, the
 * same columns — so the two lists of scores read as the same kind of thing.
 * What differs is what each is: a shared score has a person behind it, so
 * their picture and nickname head the tile, and it is somebody else's, so it
 * has no Duplicate and no Delete.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LocalizedLink } from '@/components/layout/LocalizedLink';
import { Heading, SearchInput, Section, Text, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
import { EmptyState } from '@sudobility/building_blocks';
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';
import type { CommunityItem } from '@sudobility/music_types';
import { communityItemTitle, communityListState } from '@sudobility/music_types';
import { monogramFor } from '@/app-library';
import { getAppServices } from '@/config/initialize';

/** The project tile's frame, from `DashboardPage`, with the hover a link needs. */
const TILE_CLASS = cn(
  variants.card.default.base(),
  'flex h-full flex-col gap-3 overflow-hidden rounded-md p-4 hover:bg-accent',
);

/** How wide the publisher's picture is drawn, in pixels. */
const AVATAR_SIZE = 32;

/**
 * The publisher's picture, in a circle — or their initial, when they have none.
 *
 * Decorative: the name is printed beside it, and a screen reader hearing
 * "picture of Jane, Jane" has been told the same thing twice.
 */
function PublisherAvatar({ name, avatarId }: { name: string; avatarId: string | null }) {
  /*
    A picture that will not load falls back to the initial too. The name of a
    picture is replaced whenever its owner changes it, so a list fetched a
    moment before can point at one that is gone — and a broken-image glyph in
    a circle is worse than a letter.
  */
  const [broken, setBroken] = useState(false);
  if (avatarId && !broken) {
    return (
      <img
        src={getAppServices().musicClient.avatarUrl(avatarId)}
        alt=""
        width={AVATAR_SIZE}
        height={AVATAR_SIZE}
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-medium text-muted-foreground"
    >
      {monogramFor(name)}
    </span>
  );
}

export function CommunityPage() {
  const [items, setItems] = useState<CommunityItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const navigate = useLocalizedNavigate();

  useEffect(() => {
    let cancelled = false;
    getAppServices()
      .musicClient.listCommunity()
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /*
    Which state to draw, and the rows to draw in it, are music_types' — both
    apps show this list, and a filter that differed between them would mean
    the same search found different music depending on which app you ran it
    in. The three empty states stay distinct there too: a failed load, a
    community with nothing in it, and a search that matched nothing.
  */
  const list = useMemo(() => communityListState(items, query, failed), [items, query, failed]);

  return (
    <Section spacing="xl" className="mx-auto max-w-7xl">
      <Heading level={1} size="2xl" weight="semibold">
        {t('community.title')}
      </Heading>
      <Text as="p" size="sm" color="muted" className="mt-1">
        {t('community.intro')}
      </Text>

      <SearchInput
        className="mt-6"
        value={query}
        onChange={setQuery}
        placeholder={t('community.searchPlaceholder')}
        // `type="search"` keeps the `searchbox` role the library's default
        // text input would otherwise drop, which is what assistive tech and the
        // e2e spec both look for.
        inputProps={{ 'aria-label': t('community.searchLabel'), type: 'search' }}
      />

      {list.kind === 'failed' && (
        <Text as="p" size="sm" color="muted" className="mt-6">
          {t('community.loadFailed')}
        </Text>
      )}
      {list.kind === 'empty' && (
        <div className="mt-6">
          <EmptyState
            message={t('community.empty')}
            buttonLabel={t('community.browseResources')}
            onPress={() => navigate('/resources')}
          />
        </div>
      )}
      {/* Distinct from the empty community above: a search that matches nothing
          must not read as "nobody has shared anything". */}
      {list.kind === 'noMatch' && (
        <div className="mt-6">
          <EmptyState
            message={t('community.noMatch', { query })}
            buttonLabel={t('common.clearSearch')}
            onPress={() => setQuery('')}
          />
        </div>
      )}

      {list.visible.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {list.visible.map((item) => {
            // The snapshot's own name when the public title is blank: a tile
            // published before public titles existed is not untitled.
            const title = communityItemTitle(item);
            return (
              <LocalizedLink
                key={item.publicId}
                to={`/p/${item.publicId}`}
                // "Title, by Jane": the name alone under a picture reads as
                // who shared it, but read aloud after a title it could be the
                // composer, which is a different person.
                aria-label={`${title}, ${t('community.sharedBy', { name: item.publisherName })}`}
                className={TILE_CLASS}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <PublisherAvatar name={item.publisherName} avatarId={item.publisherAvatarId} />
                  <Text size="sm" color="muted" className="min-w-0 truncate">
                    {item.publisherName}
                  </Text>
                </div>
                <div className="flex flex-col gap-1">
                  <Text size="sm" weight="medium">
                    {title}
                  </Text>
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </LocalizedLink>
            );
          })}
        </div>
      )}
    </Section>
  );
}
