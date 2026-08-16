/**
 * The credit store: balance, and the packages RevenueCat is offering.
 *
 * All presentation comes from `@sudobility/consumables_pages`; this file
 * supplies the data and the copy, so the shared component is not forked for one
 * app.
 */
import { useNavigate } from 'react-router-dom';
import {
  useBalance,
  useConsumableProducts,
  usePurchaseCredits,
} from '@sudobility/consumables_client';
import { CreditStorePage } from '@sudobility/consumables_pages';
import { useAuth } from '@/app/AuthContext';

/** The RevenueCat offering the credit packages live in. */
const OFFERING_ID = 'credits';

export function CreditsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { balance, isLoading: balanceLoading, error: balanceError } = useBalance();
  const {
    packages,
    isLoading: productsLoading,
    error: productsError,
  } = useConsumableProducts(OFFERING_ID);
  const { purchase, isPurchasing, error: purchaseError } = usePurchaseCredits();

  const error = purchaseError ?? balanceError ?? productsError;

  return (
    <CreditStorePage
      isAuthenticated={user !== null}
      balance={balance}
      packages={packages}
      isLoading={balanceLoading || productsLoading}
      isPurchasing={isPurchasing}
      error={error ? error.message : null}
      onPurchase={async (packageId: string) => {
        await purchase(packageId, OFFERING_ID);
      }}
      onLoginClick={() => {
        void navigate('/en');
      }}
      labels={{
        title: 'Credits',
        currentBalanceLabel: 'Your balance',
        creditsUnit: 'credits',
        purchaseButton: 'Buy',
        purchasingButton: 'Buying…',
        noProducts: 'No credit packages are available right now.',
        errorTitle: 'Something went wrong',
        loginRequired: 'Sign in to see your balance and buy credits.',
        loginButton: 'Sign in',
      }}
      formatters={{
        formatCredits: (count: number) => count.toLocaleString(),
        // Said in the unit a musician thinks in. "Track-measure" is the billing
        // unit and means nothing to them; "a bar for one instrument" is the
        // same quantity in words they use.
        getPackageDescription: () => 'One credit writes one bar for one instrument.',
      }}
    />
  );
}
