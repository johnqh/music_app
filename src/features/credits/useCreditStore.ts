/** Music app labels and navigation around the shared consumables store. */
import { useTranslation } from 'react-i18next';
import {
  useBalance,
  useConsumableProducts,
  usePurchaseCredits,
} from '@sudobility/consumables_client';
import type { CreditPackage } from '@sudobility/consumables_client';
import type { CreditStorePageProps } from '@sudobility/consumables_pages';
import { useAuth } from '@/app/AuthContext';
import { useSignIn } from '@/features/auth/SignInModal';

export type UseCreditStoreOptions = { onPurchased?: () => void };

export function useCreditStore({ onPurchased }: UseCreditStoreOptions = {}): CreditStorePageProps {
  const { t } = useTranslation();
  const { openSignIn } = useSignIn();
  const { user } = useAuth();
  const balanceState = useBalance();
  // An empty offering ID asks the shared client for every configured offering.
  const products = useConsumableProducts('');
  const purchaseState = usePurchaseCredits();

  return {
    isAuthenticated: user !== null,
    balance: balanceState.balance,
    packages: products.packages,
    isLoading: balanceState.isLoading || products.isLoading,
    isPurchasing: purchaseState.isPurchasing,
    error:
      purchaseState.error?.message ??
      balanceState.error?.message ??
      products.error?.message ??
      null,
    onPurchase: async (packageId: string) => {
      const selected = products.packages.find((pkg: CreditPackage) => pkg.packageId === packageId);
      if (!selected?.offeringId) throw new Error('This credit package is no longer available.');
      const purchased = await purchaseState.purchase(
        selected.storePackageId ?? selected.packageId,
        selected.offeringId,
      );
      if (purchased) onPurchased?.();
    },
    // Over the page that asked, never a trip to the sign-in route: signing in
    // leaves the reader on the store (or the paywall), now signed in.
    onLoginClick: () => openSignIn(),
    labels: {
      title: t('credits.title'),
      currentBalanceLabel: t('credits.balance'),
      creditsUnit: t('credits.unit'),
      purchaseButton: t('credits.buy'),
      purchasingButton: t('credits.buying'),
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
