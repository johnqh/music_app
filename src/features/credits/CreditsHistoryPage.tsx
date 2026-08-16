/**
 * What was bought, and what it was spent on.
 *
 * Both lists come from `@sudobility/consumables_pages`; this file supplies the
 * data and the copy.
 */
import { usePurchaseHistory, useUsageHistory } from '@sudobility/consumables_client';
import { PurchaseHistoryPage, UsageHistoryPage } from '@sudobility/consumables_pages';

/** Rows per page. Must match what is passed to the hooks, for the `hasMore` rule below. */
const PAGE_SIZE = 25;

/**
 * Whether to offer "load more".
 *
 * The hooks report no total, so a full page is the only available signal that
 * another might exist. It errs towards offering the button once too often —
 * which loads nothing and disappears — rather than hiding history that is
 * there.
 */
function mayHaveMore(count: number): boolean {
  return count > 0 && count % PAGE_SIZE === 0;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? dateStr : date.toLocaleDateString();
}

export function CreditsHistoryPage() {
  const purchases = usePurchaseHistory(PAGE_SIZE);
  const usages = useUsageHistory(PAGE_SIZE);

  return (
    <div className="flex flex-col gap-10">
      <PurchaseHistoryPage
        purchases={purchases.purchases}
        isLoading={purchases.isLoading}
        error={purchases.error ? purchases.error.message : null}
        onLoadMore={() => void purchases.loadMore()}
        hasMore={mayHaveMore(purchases.purchases.length)}
        labels={{
          title: 'Purchases',
          columnDate: 'Date',
          columnCredits: 'Credits',
          columnSource: 'Source',
          columnProduct: 'Package',
          columnAmount: 'Amount',
          noRecords: 'No purchases yet.',
          loadMore: 'Load more',
        }}
        formatters={{
          formatDate,
          formatAmount: (cents, currency) =>
            new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100),
          // The free grant arrives as a purchase from source "free", which is
          // the honest word for it — it was not bought.
          formatSource: (source) =>
            ({ web: 'Web', apple: 'App Store', google: 'Google Play', free: 'Free' })[source] ??
            source,
        }}
      />

      <UsageHistoryPage
        usages={usages.usages}
        isLoading={usages.isLoading}
        error={usages.error ? usages.error.message : null}
        onLoadMore={() => void usages.loadMore()}
        hasMore={mayHaveMore(usages.usages.length)}
        labels={{
          title: 'Usage',
          columnDate: 'Date',
          // The rows carry a `reference` like "generate-track — 4
          // track-measures"; the shared component prefers it over `filename`.
          columnFilename: 'Generation',
          columnCredits: 'Credits',
          noRecords: 'No credits spent yet.',
          loadMore: 'Load more',
        }}
        formatters={{ formatDate }}
      />
    </div>
  );
}
