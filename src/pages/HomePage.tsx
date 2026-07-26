/**
 * Home page (APP.md content-page pattern): Section-based hero + feature
 * blocks; the CTA leads to the projects dashboard.
 */
import { useTranslation } from 'react-i18next';
import { Section, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';

export default function HomePage() {
  const { t } = useTranslation();
  const navigate = useLocalizedNavigate();

  return (
    <>
      <Section spacing="5xl" variant="hero">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-theme-text-primary sm:text-5xl">
            {t('home.heroTitle')}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-theme-text-secondary">
            {t('home.heroBody')}
          </p>
          <button
            type="button"
            className={cn(variants.button.primary.large(), 'mt-8 shadow')}
            onClick={() => navigate('/projects')}
          >
            {t('home.cta')}
          </button>
        </div>
      </Section>
      <Section spacing="3xl">
        <div className="grid gap-8 sm:grid-cols-3">
          {(
            [
              ['home.featureEditorTitle', 'home.featureEditorBody'],
              ['home.featureAiTitle', 'home.featureAiBody'],
              ['home.featureFormatsTitle', 'home.featureFormatsBody'],
            ] as const
          ).map(([title, body]) => (
            <div key={title} className={cn(variants.card.default.base(), 'rounded-xl p-6')}>
              <h2 className="text-lg font-semibold text-theme-text-primary">{t(title)}</h2>
              <p className="mt-2 text-sm text-theme-text-secondary">{t(body)}</p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
