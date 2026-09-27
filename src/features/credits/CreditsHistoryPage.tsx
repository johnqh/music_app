/**
 * What was bought, and what it was spent on.
 *
 * Both lists come from `@sudobility/consumables_pages`; this file supplies the
 * data and the copy.
 */
import { usePurchaseHistory, useUsageHistory } from '@sudobility/consumables_client';
import { useTranslation } from 'react-i18next';
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

export function CreditsHistoryPage({
  onPurchaseCredits,
}: {
  onPurchaseCredits?: () => void;
} = {}) {
  const { t } = useTranslation();
  const purchases = usePurchaseHistory(PAGE_SIZE);
  const usages = useUsageHistory(PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      {onPurchaseCredits && (
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md bg-theme-primary px-4 py-2 font-medium text-white"
            onClick={onPurchaseCredits}
          >
            Purchase Credit
          </button>
        </div>
      )}
      <div className="flex flex-col gap-10">
        <PurchaseHistoryPage
          purchases={purchases.purchases}
          isLoading={purchases.isLoading}
          error={purchases.error ? purchases.error.message : null}
          onLoadMore={() => void purchases.loadMore()}
          hasMore={mayHaveMore(purchases.purchases.length)}
          labels={{
            title: t('nav.purchases'),
            columnDate: t('history.date'),
            columnCredits: t('credits.title'),
            columnSource: t('history.source'),
            columnProduct: t('history.package'),
            columnAmount: t('history.amount'),
            noRecords: t('history.noPurchases'),
            loadMore: t('history.loadMore'),
          }}
          formatters={{
            formatDate,
            formatAmount: (cents, currency) =>
              new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100),
            // The free grant arrives as a purchase from source "free", which is
            // the honest word for it — it was not bought.
            formatSource: (source) =>
              ({
                web: t('history.sourceWeb'),
                apple: t('history.sourceApple'),
                google: t('history.sourceGoogle'),
                free: t('history.sourceFree'),
              })[source] ?? source,
          }}
        />

        <UsageHistoryPage
          usages={usages.usages}
          isLoading={usages.isLoading}
          error={usages.error ? usages.error.message : null}
          onLoadMore={() => void usages.loadMore()}
          hasMore={mayHaveMore(usages.usages.length)}
          labels={{
            title: t('history.usage'),
            columnDate: t('history.date'),
            // The rows carry a `reference` like "generate-track — 4
            // track-measures"; the shared component prefers it over `filename`.
            columnFilename: t('history.generation'),
            columnCredits: t('credits.title'),
            noRecords: t('history.noUsage'),
            loadMore: t('history.loadMore'),
          }}
          formatters={{ formatDate }}
        />
      </div>
    </div>
  );
}
