/**
 * The credit store: balance, what a credit buys, and the packages on offer.
 *
 * Presentation comes from `@sudobility/consumables_pages`; this file supplies
 * the data and the copy, so the shared component is not forked for one app.
 *
 * The unit is a *credit*, explained in measures rather than renamed to one.
 * `music_api` bills per track-measure (`creditsForTrackMeasures`): a four-bar
 * quartet is sixteen credits, not four. Calling a credit a "measure" would
 * understate every multi-instrument score fourfold on the one screen where
 * being wrong costs the reader money, so the copy says what a credit actually
 * writes — one bar, for one instrument.
 */
import { useTranslation } from 'react-i18next';
import {
  useBalance,
  useConsumableProducts,
  usePurchaseCredits,
} from '@sudobility/consumables_client';
import { CreditStorePage } from '@sudobility/consumables_pages';
import { Card, Section, Stack, Text } from '@sudobility/components';
import { useAuth } from '@/app/AuthContext';
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';

/** The RevenueCat offering the credit packages live in. */
const OFFERING_ID = 'credits';

export function CreditsPage() {
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

  return (
    <Section spacing="xl" className="mx-auto max-w-3xl">
      <Stack direction="vertical" spacing="lg">
        {/* What a credit is, above the store: the balance is meaningless
            without it, and the Generate dialog quotes bars × instruments. */}
        <Card variant="bordered" padding="md">
          <Stack direction="vertical" spacing="xs">
            <Text weight="medium">{t('credits.whatIsACredit')}</Text>
            <Text size="sm" color="muted">
              {t('credits.explanation')}
            </Text>
            <Text size="sm" color="muted">
              {t('credits.rate')}
            </Text>
          </Stack>
        </Card>

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
          onLoginClick={() => navigate('/signin')}
          labels={{
            title: t('credits.title'),
            currentBalanceLabel: t('credits.balance'),
            creditsUnit: t('credits.unit'),
            purchaseButton: t('credits.buy'),
            purchasingButton: t('credits.buying'),
            // Says *why* there is nothing to buy. An unconfigured store is the
            // usual cause — `CREDIT_PRODUCTS` on the server, or the RevenueCat
            // key on the client — and "none available" alone reads as a bug.
            noProducts: t('credits.noPackages'),
            errorTitle: t('credits.errorTitle'),
            loginRequired: t('credits.loginRequired'),
            loginButton: t('nav.signIn'),
          }}
          formatters={{
            formatCredits: (count: number) => count.toLocaleString(),
            getPackageDescription: () => t('credits.packageDescription'),
          }}
        />
      </Stack>
    </Section>
  );
}
