/**
 * The public Community list.
 *
 * Rendered **outside** the auth gate: a stranger with no account can browse it.
 * Fetched with no token, because a visitor has none.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CommunityItem } from '@sudobility/music_types';
import { getAppServices } from '@/config/initialize';

export function CommunityPage() {
  const { lang = 'en' } = useParams();
  const [items, setItems] = useState<CommunityItem[] | null>(null);
  const [failed, setFailed] = useState(false);

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

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-theme-text-primary">Community</h1>
      <p className="mt-1 text-sm text-theme-text-secondary">
        Snapshots people have shared. Anyone can listen — no account needed.
      </p>

      {failed && <p className="mt-6 text-sm text-theme-text-secondary">Could not load.</p>}
      {items && items.length === 0 && (
        <p className="mt-6 text-sm text-theme-text-secondary">Nothing has been shared yet.</p>
      )}

      <ul className="mt-6 flex flex-col gap-2">
        {(items ?? []).map((item) => (
          <li key={item.publicId}>
            <Link
              to={`/${lang}/p/${item.publicId}`}
              className="flex items-baseline justify-between rounded border border-theme-border px-3 py-2 hover:bg-theme-hover-bg"
            >
              <span className="font-medium text-theme-text-primary">{item.name}</span>
              <span className="text-sm text-theme-text-secondary">
                by {item.publisherName} · {new Date(item.createdAt).toLocaleDateString()}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
