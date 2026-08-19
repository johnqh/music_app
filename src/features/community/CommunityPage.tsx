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
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LocalizedLink } from '@/components/layout/LocalizedLink';
import { Card, Heading, SearchInput, Section, Stack, Text } from '@sudobility/components';
import { EmptyState } from '@sudobility/building_blocks';
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';
import type { CommunityItem } from '@sudobility/music_types';
import { getAppServices } from '@/config/initialize';

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

  // Title and publisher, which is what someone scanning this list is reading.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items ?? [];
    return (items ?? []).filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.publisherName.toLowerCase().includes(needle),
    );
  }, [items, query]);

  return (
    <Section spacing="xl" className="mx-auto max-w-3xl">
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

      {failed && (
        <Text as="p" size="sm" color="muted" className="mt-6">
          {t('community.loadFailed')}
        </Text>
      )}
      {items && items.length === 0 && (
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
      {items && items.length > 0 && visible.length === 0 && (
        <div className="mt-6">
          <EmptyState
            message={t('community.noMatch', { query })}
            buttonLabel={t('common.clearSearch')}
            onPress={() => setQuery('')}
          />
        </div>
      )}

      <Stack direction="vertical" spacing="sm" className="mt-6">
        {visible.map((item) => (
          <LocalizedLink key={item.publicId} to={`/p/${item.publicId}`}>
            <Card variant="bordered" padding="sm" className="hover:bg-theme-hover-bg">
              <div className="flex items-baseline justify-between gap-3">
                <Text weight="medium">{item.name}</Text>
                <Text size="sm" color="muted">
                  {t('community.sharedBy', { name: item.publisherName })} ·{' '}
                  {new Date(item.createdAt).toLocaleDateString()}
                </Text>
              </div>
            </Card>
          </LocalizedLink>
        ))}
      </Stack>
    </Section>
  );
}
