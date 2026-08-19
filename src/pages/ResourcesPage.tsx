/**
 * Where to find music files worth importing.
 *
 * The app reads five formats and generates a sixth, but a new user has nothing
 * to open. This page answers "now what do I import?" by pointing at the
 * long-standing free archives — and, more usefully, by saying which importer
 * each one feeds, so the trip from download to open score is one hop.
 *
 * Built from the same `Section`/`Card`/`Heading`/`Text` vocabulary as
 * `HomePage`, so the two read as one site rather than two.
 *
 * Every link leaves the app, so each carries `rel="noopener noreferrer"` — a
 * target-blank link without it hands the opened page a live `window.opener`.
 */
import { useTranslation } from 'react-i18next';
import { Card, Grid, Heading, Section, Text } from '@sudobility/components';

type Resource = {
  key: string;
  name: string;
  url: string;
  /** Which of this app's importers the files feed. */
  importPath: string;
};

/**
 * Chosen for being free, long-lived and directly importable here. The Mod
 * Archive is also where this app's own tracker-decoder fixtures came from, so
 * its files are the ones the importer is tested against.
 */
const RESOURCES: readonly Resource[] = [
  {
    key: 'modarchive',
    name: 'The Mod Archive',
    url: 'https://modarchive.org/',
    importPath: 'resources.viaModule',
  },
  {
    key: 'bitmidi',
    name: 'BitMidi',
    url: 'https://bitmidi.com/',
    importPath: 'resources.viaMidi',
  },
  {
    key: 'musescore',
    name: 'MuseScore',
    url: 'https://musescore.com/sheetmusic',
    importPath: 'resources.viaMusicXml',
  },
  {
    key: 'imslp',
    name: 'IMSLP',
    url: 'https://imslp.org/',
    importPath: 'resources.viaMusicXml',
  },
  {
    key: 'freepats',
    name: 'FreePATS',
    url: 'https://freepats.zenvoid.org/',
    importPath: 'resources.viaInstruments',
  },
];

export default function ResourcesPage() {
  const { t } = useTranslation();

  return (
    <>
      <Section spacing="3xl">
        <Heading level={1} size="3xl" weight="bold">
          {t('resources.title')}
        </Heading>
        <Text as="p" size="lg" color="muted" className="mt-3 max-w-3xl">
          {t('resources.intro')}
        </Text>
      </Section>

      <Section spacing="3xl">
        <Grid cols={{ sm: 2, lg: 3 }} gap="lg">
          {RESOURCES.map((resource) => (
            <Card key={resource.key} variant="elevated" padding="lg">
              <Heading level={2} size="lg" weight="semibold">
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 hover:underline"
                >
                  {resource.name}
                </a>
              </Heading>
              <Text as="p" size="sm" color="muted" className="mt-2">
                {t(`resources.${resource.key}Body`)}
              </Text>
              <Text as="p" size="xs" color="muted" className="mt-3">
                {t(resource.importPath)}
              </Text>
            </Card>
          ))}
        </Grid>
      </Section>
    </>
  );
}
