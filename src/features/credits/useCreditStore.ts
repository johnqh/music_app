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
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getConsumablesInstance,
  isConsumablesInitialized,
  useBalance,
  useConsumableProducts,
  usePurchaseCredits,
} from '@sudobility/consumables_client';
import type { CreditPackage } from '@sudobility/consumables_client';
import type { CreditStorePageProps } from '@sudobility/consumables_pages';
import { useAuth } from '@/app/AuthContext';
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';
import { getAppServices } from '@/config/initialize';

export type UseCreditStoreOptions = {
  /** Called after a purchase settles, so a modal can close itself. */
  onPurchased?: () => void;
};

type RevenueCatPackage = CreditPackage & { offeringId: string };

export function useCreditStore({ onPurchased }: UseCreditStoreOptions = {}): CreditStorePageProps {
  const { t } = useTranslation();
  const navigate = useLocalizedNavigate();
  const { user } = useAuth();
  const { balance, isLoading: balanceLoading, error: balanceError } = useBalance();
  const {
    packages: mappedPackages,
    isLoading: mappedPackagesLoading,
    error: mappedPackagesError,
  } = useConsumableProducts('');
  const [creditsByProductId, setCreditsByProductId] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [creditProductsLoading, setCreditProductsLoading] = useState(true);
  const [creditProductsError, setCreditProductsError] = useState<Error | null>(null);
  const [revenueCatPackages, setRevenueCatPackages] = useState<RevenueCatPackage[]>([]);
  const [revenueCatLoading, setRevenueCatLoading] = useState(true);
  const [revenueCatError, setRevenueCatError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    try {
      const { baseUrl, networkClient } = getAppServices();
      networkClient
        .get<{
          success: boolean;
          data?: { products: Array<{ productId: string; credits: number }> };
          error?: string;
        }>(`${baseUrl}/api/v1/public/consumables/offerings`)
        .then((response) => {
          if (!response.ok || !response.data?.data) {
            throw new Error(response.data?.error || 'Unable to load credit package amounts.');
          }
          if (active) {
            setCreditsByProductId(
              new Map(
                response.data.data.products.map(({ productId, credits }) => [
                  productId.toLowerCase(),
                  credits,
                ]),
              ),
            );
          }
        })
        .catch((err: unknown) => {
          if (active) setCreditProductsError(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          if (active) setCreditProductsLoading(false);
        });
    } catch (err) {
      setCreditProductsError(err instanceof Error ? err : new Error(String(err)));
      setCreditProductsLoading(false);
    }
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadPackages = async () => {
      try {
        if (!isConsumablesInitialized()) {
          throw new Error('Consumables are not initialized.');
        }
        // Let the shared consumables adapter initialize/configure RevenueCat,
        // then read the raw catalog. Its product hook filters unmatched IDs;
        // here we need all offerings so an ID capitalization mismatch cannot
        // make a configured RevenueCat product disappear from the store.
        try {
          await getConsumablesInstance().loadOfferings();
        } catch {
          // The public catalog fetch below can still succeed if the optional
          // server mapping endpoint is temporarily unavailable.
        }
        const { Purchases } = await import('@revenuecat/purchases-js');
        const offerings = await Purchases.getSharedInstance().getOfferings();
        const packages = Object.values(offerings.all).flatMap((offering) =>
          offering.availablePackages.map((rcPackage) => {
            const product = rcPackage.rcBillingProduct;
            const productPrice = product.currentPrice;
            return {
              packageId: rcPackage.identifier,
              productId: product.identifier,
              title: product.title,
              description: product.description || null,
              credits: 0,
              price: productPrice.amountMicros / 1_000_000,
              priceString: productPrice.formattedPrice || '$0',
              currencyCode: productPrice.currency || 'USD',
              offeringId: offering.identifier,
            };
          }),
        );
        if (active) setRevenueCatPackages(packages);
      } catch (err) {
        if (active) setRevenueCatError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (active) setRevenueCatLoading(false);
      }
    };
    void loadPackages();
    return () => {
      active = false;
    };
  }, []);

  const { purchase, isPurchasing, error: purchaseError } = usePurchaseCredits();

  // RevenueCat controls which offerings are available. Flatten every offering
  // after the shared client has loaded them so new products appear without
  // hardcoding an offering identifier in the app.
  const { packages, purchaseTargets } = useMemo(() => {
    const allPackages: CreditPackage[] = [];
    const targets = new Map<string, { packageId: string; offeringId: string }>();
    if (revenueCatPackages.length > 0) {
      for (const product of revenueCatPackages) {
        // RevenueCat product identifiers are case-sensitive when buying, but
        // the credit lookup tolerates capitalization differences in config.
        const credits = creditsByProductId.get(product.productId.toLowerCase());
        const viewId = `${product.offeringId}::${product.packageId}`;
        allPackages.push({ ...product, packageId: viewId, credits: credits ?? product.credits });
        targets.set(viewId, { packageId: product.packageId, offeringId: product.offeringId });
      }
    } else {
      // The shared hook is also the fallback for hosts/tests where the raw
      // RevenueCat SDK is not directly available.
      for (const product of mappedPackages) {
        const viewId = `mapped::${product.packageId}`;
        allPackages.push({ ...product, packageId: viewId });
        targets.set(viewId, { packageId: product.packageId, offeringId: '' });
      }
    }
    return { packages: allPackages, purchaseTargets: targets };
  }, [creditsByProductId, mappedPackages, revenueCatPackages]);

  const error =
    purchaseError ?? balanceError ?? revenueCatError ?? mappedPackagesError ?? creditProductsError;

  return {
    isAuthenticated: user !== null,
    balance,
    packages,
    isLoading:
      balanceLoading || mappedPackagesLoading || revenueCatLoading || creditProductsLoading,
    isPurchasing,
    error: error ? error.message : null,
    onPurchase: async (packageId: string) => {
      const target = purchaseTargets.get(packageId);
      if (!target) throw new Error('This credit package is no longer available.');
      await purchase(target.packageId, target.offeringId);
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
