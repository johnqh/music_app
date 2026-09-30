/**
 * A page that is a master list and a detail, each scrolling on its own.
 *
 * Every master/detail page in the app is drawn through this, because the
 * library's `MasterDetailLayout` scrolls only when what holds it has a
 * height, and nothing about the layout says so when it does not. Its root is
 * `flex-1 min-h-0`: inside a flex column it takes the height left over and
 * its panels scroll within it; inside an ordinary block those classes mean
 * nothing, it grows to the height of its content, and its panels — told to
 * scroll when they overflow — never overflow. The page, meanwhile, has been
 * told not to scroll, so the content past the fold cannot be reached at all.
 * Measured on the docs page: a detail panel 5,219px tall in a 720px window,
 * and nothing that scrolled.
 *
 * So the holder is a flex column with a height, stated once here, along with
 * the page config that goes with it. `overflow-y-auto` on both panels is the
 * layout's own; the classes passed for each add `overscroll-contain`, so that
 * reaching the end of a panel does not start moving the page behind it.
 */
import { MasterDetailLayout } from '@sudobility/components';
import type { MasterDetailLayoutProps } from '@sudobility/components';
import { useSetPageConfig } from '@/hooks/usePageConfig';

const PANEL_CLASS = 'min-h-0 overflow-y-auto overscroll-contain';

export type MasterDetailPageProps = Omit<
  MasterDetailLayoutProps,
  'masterClassName' | 'detailClassName'
>;

export function MasterDetailPage(props: MasterDetailPageProps) {
  // The panels scroll, not the page: that is what keeps the list in place.
  useSetPageConfig({
    layoutMode: 'full',
    maxWidth: 'full',
    contentPadding: 'none',
    scrollable: false,
  });
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      <MasterDetailLayout
        masterWidth={280}
        detailMaxWidth={1024}
        detailPadding
        {...props}
        masterClassName={PANEL_CLASS}
        detailClassName={PANEL_CLASS}
      />
    </div>
  );
}
