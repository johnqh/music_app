/**
 * Home page (APP.md content-page pattern): a hero and a row of feature cards,
 * with the CTA leading to the projects dashboard.
 *
 * Built from the shared vocabulary — `Section`, `Card`, `Heading`, `Text`,
 * `Button` — rather than hand-rolled headings and divs, which is the sudojo_app
 * pattern. The value is not fewer lines but one place to change: type scale and
 * card treatment come from the library, so this page follows a design change
 * instead of drifting from it.
 *
 * The sections carry no width of their own. They inherit it from the page's
 * `layoutMode` (set to `full` in `ScreenContainer`, to match the editor), so
 * the hero and the cards line up with the topbar and the footer. Overriding
 * width here instead would put the content edge to edge while the topbar kept
 * its own — which is exactly the misalignment that made this page look wrong.
 *
 * Reading measure is protected per element, which is where it belongs: the
 * hero paragraph keeps its own `max-w-3xl`, since a line of prose spanning an
 * ultrawide monitor is unreadable, while the feature grid wants the room.
 */
import { useTranslation } from 'react-i18next';
import { Button, Card, Heading, Section, Text } from '@sudobility/components';
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';

/** Feature cards, in the order they read. Keys resolve against `app.json`. */
const FEATURES = [
  { key: 'editor', title: 'home.featureEditorTitle', body: 'home.featureEditorBody' },
  { key: 'ai', title: 'home.featureAiTitle', body: 'home.featureAiBody' },
  { key: 'formats', title: 'home.featureFormatsTitle', body: 'home.featureFormatsBody' },
] as const;

export default function HomePage() {
  const { t } = useTranslation();
  const navigate = useLocalizedNavigate();

  return (
    <>
      <Section spacing="5xl" variant="hero">
        <div className="text-center">
          <Heading level={1} size="4xl" weight="bold" align="center">
            {t('home.heroTitle')}
          </Heading>
          <Text as="p" size="lg" color="muted" align="center" className="mx-auto mt-4 max-w-3xl">
            {t('home.heroBody')}
          </Text>
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="mt-8 shadow"
            onClick={() => navigate('/projects')}
          >
            {t('home.cta')}
          </Button>
        </div>
      </Section>

      <Section spacing="3xl">
        <div className="grid gap-8 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.key} variant="elevated" padding="lg" className="rounded-xl">
              <Heading level={2} size="lg" weight="semibold">
                {t(feature.title)}
              </Heading>
              <Text as="p" size="sm" color="muted" className="mt-2">
                {t(feature.body)}
              </Text>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
