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
import { Link } from 'react-router-dom';
import { Card, Section, Stack, Text } from '@sudobility/components';
import { CreditStore } from '@/features/credits/CreditStore';
import { useCurrentLanguage } from '@/hooks/useLocalizedNavigate';

export function CreditsPage({ onRedeemCoupon }: { onRedeemCoupon?: () => void } = {}) {
  const { t } = useTranslation();
  const lang = useCurrentLanguage();

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

        <CreditStore />
        {onRedeemCoupon ? (
          <button
            type="button"
            className="w-fit text-sm font-medium text-primary underline"
            onClick={onRedeemCoupon}
          >
            Redeem a credit coupon
          </button>
        ) : (
          <Link
            className="text-sm font-medium text-primary underline"
            to={`/${lang}/credits/coupons`}
          >
            Redeem a credit coupon
          </Link>
        )}
      </Stack>
    </Section>
  );
}
