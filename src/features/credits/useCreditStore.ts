/**
 * Everything the credit store needs, in the shape the shared components take.
 *
 * The store is shown in two places — the Credits page and the paywall a
 * refused job raises — and both need the same balance, the same packages, the
 * same purchase call and the same eleven labels. Wiring that twice is how the
 * two would come to disagree about what a credit is called, so it is wired
 * here and both spread the result.
 *
 * Returns props rather than rendering anything: the page and the dialog are
 * different components in `@sudobility/consumables_pages`, and only their
 * host knows which one it wants.
 */
import { useTranslation } from 'react-i18next';
import {
  useBalance,
  useConsumableProducts,
  usePurchaseCredits,
} from '@sudobility/consumables_client';
import type { CreditStorePageProps } from '@sudobility/consumables_pages';
import { useAuth } from '@/app/AuthContext';
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';

/** The RevenueCat offering the credit packages live in. */
const OFFERING_ID = 'credits';

export type UseCreditStoreOptions = {
  /** Called after a purchase settles, so a modal can close itself. */
  onPurchased?: () => void;
};

export function useCreditStore({ onPurchased }: UseCreditStoreOptions = {}): CreditStorePageProps {
  const { t } = useTranslation();
  const navigate = useLocalizedNavigate();
  const { user } = useAuth();
  const { balance, isLoading: balanceLoading, error: balanceError } = useBalance();
  const {
    packages,
    isLoading: productsLoading,
    error: productsError,
  } = useConsumableProducts(OFFERING_ID);
  const { purchase, isPurchasing, error: purchaseError } = usePurchaseCredits();

  const error = purchaseError ?? balanceError ?? productsError;

  return {
    isAuthenticated: user !== null,
    balance,
    packages,
    isLoading: balanceLoading || productsLoading,
    isPurchasing,
    error: error ? error.message : null,
    onPurchase: async (packageId: string) => {
      await purchase(packageId, OFFERING_ID);
      onPurchased?.();
    },
    onLoginClick: () => navigate('/signin'),
    labels: {
      title: t('credits.title'),
      currentBalanceLabel: t('credits.balance'),
      creditsUnit: t('credits.unit'),
      purchaseButton: t('credits.buy'),
      purchasingButton: t('credits.buying'),
      // Says *why* there is nothing to buy. An unconfigured store is the usual
      // cause — `CREDIT_PRODUCTS` on the server, or the RevenueCat key on the
      // client — and "none available" alone reads as a bug.
      noProducts: t('credits.noPackages'),
      errorTitle: t('credits.errorTitle'),
      loginRequired: t('credits.loginRequired'),
      loginButton: t('nav.signIn'),
    },
    formatters: {
      formatCredits: (count: number) => count.toLocaleString(),
      getPackageDescription: () => t('credits.packageDescription'),
    },
  };
}
