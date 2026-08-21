/**
 * Where the top bar's menu items actually navigate.
 *
 * The library renders each item through the `LinkComponent` it is handed and
 * passes the destination as `href`. React Router's `Link` navigates by `to`
 * and overwrites `href` with `useHref(to)`, so passing `Link` in directly made
 * every item resolve to the page already open — all four looked dead. This
 * pins the adapter that bridges the two.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
import { AppTopBar } from '@sudobility/building_blocks';
import { LinkWrapper } from '@/components/layout/LinkWrapper';

const ITEMS = [
  { id: 'projects', label: 'Projects', href: '/en/projects' },
  { id: 'community', label: 'Community', href: '/en/community' },
  { id: 'resources', label: 'Resources', href: '/en/resources' },
  { id: 'settings', label: 'Settings', href: '/en/settings' },
];

function renderTopBar(LinkComponent: unknown) {
  render(
    <MemoryRouter initialEntries={['/en/projects/42']}>
      <AppTopBar
        logo={{ src: '/logo-96.png', appName: 'Moosiac' }}
        menuItems={ITEMS}
        LinkComponent={LinkComponent as never}
        hideLanguageSelector
      />
    </MemoryRouter>,
  );
}

describe('top bar menu items', () => {
  it.each(ITEMS)('$label points at $href, not the current page', ({ label, href }) => {
    renderTopBar(LinkWrapper);
    const link = screen.getAllByRole('link', { name: label })[0];
    expect(link.getAttribute('href')).toBe(href);
  });

  it('regression: react-router Link passed directly resolves to the current page', () => {
    // The shape of the original bug, kept so the adapter cannot be quietly
    // dropped in favour of `Link as never` again.
    renderTopBar(Link);
    const link = screen.getAllByRole('link', { name: 'Settings' })[0];
    expect(link.getAttribute('href')).toBe('/en/projects/42');
  });
});
