/**
 * The holder every master/detail page is drawn in.
 *
 * What makes the panels scroll is layout, which jsdom does not do — the
 * measurement is `e2e/docs.spec.ts`'s. What can be pinned here is what the
 * measurement depends on: that the holder is a flex column with a height,
 * that both panels are told to scroll, and that no page draws the library's
 * layout without going through it.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { globSync, readFileSync } from 'node:fs';

const setPageConfig = vi.fn();
vi.mock('@/hooks/usePageConfig', () => ({
  useSetPageConfig: (config: unknown) => setPageConfig(config),
}));
vi.mock('@sudobility/components', () => ({
  MasterDetailLayout: (props: Record<string, unknown>) => (
    <div data-testid="layout" data-props={JSON.stringify(props)} />
  ),
}));

const { MasterDetailPage } = await import('./MasterDetailPage');

function layoutProps(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('layout').dataset.props ?? '{}') as Record<string, unknown>;
}

describe('MasterDetailPage', () => {
  it('holds the layout in a flex column that has a height', () => {
    render(<MasterDetailPage masterContent="list" detailContent="detail" />);
    const holder = screen.getByTestId('layout').parentElement!;
    // Each of these is load-bearing: without `flex flex-col` the layout's own
    // `flex-1` means nothing and it grows to the height of its content.
    for (const name of ['flex', 'flex-col', 'h-full', 'min-h-0', 'flex-1']) {
      expect(holder.classList.contains(name), name).toBe(true);
    }
  });

  it('tells both panels to scroll, and the page not to', () => {
    render(<MasterDetailPage masterContent="list" detailContent="detail" />);
    const props = layoutProps();
    expect(props.detailClassName).toMatch(/overflow-y-auto/);
    expect(props.detailClassName).toMatch(/min-h-0/);
    expect(props.masterClassName).toMatch(/overflow-y-auto/);
    expect(setPageConfig).toHaveBeenCalledWith(expect.objectContaining({ scrollable: false }));
  });

  it('lets a page choose its widths, but not take the scrolling away', () => {
    render(
      <MasterDetailPage
        masterContent="list"
        detailContent="detail"
        masterWidth={320}
        {...({ detailClassName: 'overflow-hidden' } as object)}
      />,
    );
    const props = layoutProps();
    expect(props.masterWidth).toBe(320);
    expect(props.detailClassName).toMatch(/overflow-y-auto/);
  });
});

describe('master/detail pages', () => {
  it('all go through MasterDetailPage', () => {
    /*
      The library's layout scrolls only inside a holder with a height, and
      says nothing when it has none: the docs page and the dashboard both drew
      it in a plain block, and neither could be scrolled.
    */
    const direct = globSync('src/**/*.tsx')
      .filter((file) => !file.includes('.test.'))
      .filter((file) => file !== 'src/components/layout/MasterDetailPage.tsx')
      // Imported, not merely named: a comment may say what a page is built on.
      .filter((file) =>
        /import\s*(type\s*)?\{[^}]*\bMasterDetailLayout\b[^}]*\}\s*from/.test(
          readFileSync(file, 'utf8'),
        ),
      );
    expect(direct).toEqual([]);
  });
});
