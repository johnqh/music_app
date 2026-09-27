import { CreditHistoryPage } from '@sudobility/consumables_pages';
import { useTranslation } from 'react-i18next';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? dateStr : date.toLocaleDateString();
}

export function CreditsHistoryPage({ onPurchaseCredits }: { onPurchaseCredits?: () => void } = {}) {
  const { t } = useTranslation();
  return (
    <CreditHistoryPage
      pageSize={25}
      onPurchaseCredits={onPurchaseCredits}
      purchaseButtonLabel="Purchase Credit"
      purchaseLabels={{
        title: t('nav.purchases'),
        columnDate: t('history.date'),
        columnCredits: t('credits.title'),
        columnSource: t('history.source'),
        columnProduct: t('history.package'),
        columnAmount: t('history.amount'),
        noRecords: t('history.noPurchases'),
        loadMore: t('history.loadMore'),
      }}
      purchaseFormatters={{
        formatDate,
        formatAmount: (cents, currency) =>
          new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100),
        formatSource: (source) =>
          ({
            web: t('history.sourceWeb'),
            apple: t('history.sourceApple'),
            google: t('history.sourceGoogle'),
            free: t('history.sourceFree'),
          })[source] ?? source,
      }}
      usageLabels={{
        title: t('history.usage'),
        columnDate: t('history.date'),
        columnFilename: t('history.generation'),
        columnCredits: t('credits.title'),
        noRecords: t('history.noUsage'),
        loadMore: t('history.loadMore'),
      }}
      usageFormatters={{ formatDate }}
      className="flex flex-col gap-6"
    />
  );
}
