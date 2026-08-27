/**
 * Where to find music worth importing.
 *
 * The app reads five formats and generates a sixth, but a new account has
 * nothing to open. This page answers "now what do I import?" — and the useful
 * half of that answer is not the link, it is *which importer the file feeds*.
 * So the page is grouped by import route rather than by genre or popularity:
 * every card under "Sheet music" opens with Import → MusicXML, every card
 * under "Tracker modules" opens with Import → Module, and the two sections at
 * the end are honest about feeding no importer at all.
 *
 * That grouping is also what lets the list grow. The page carried five cards,
 * each repeating its own "Opens with Import → MIDI" line — fine at five and a
 * wall at forty. Stating the route once per section removes forty repetitions
 * and turns the section heading into the thing a reader navigates by.
 *
 * The host is printed under each name and is **derived from the URL**, never
 * typed: a page that is nothing but outbound links should say where each one
 * goes, and a hand-written host would be the one field free to disagree with
 * the href above it.
 *
 * Each tile carries the site's own icon, vendored by
 * `scripts/fetch-resource-icons.ts` rather than hotlinked — see
 * `resource-links.ts`. Every one sits on the **same light chip** in both
 * themes, which is the one deliberate deviation from the page's colour
 * handling: these are thirty-eight logos drawn by thirty-eight people, and a
 * good few are solid black on transparent. Letting them inherit the surface
 * makes those vanish entirely the moment the page goes dark, so the chip is
 * the background they were each drawn against. It also does the work a row of
 * mismatched marks needs anyway — one shape, one size, one edge.
 *
 * Built from the same `Section`/`Card`/`Grid`/`Heading`/`Text` vocabulary as
 * `HomePage`, so the two read as one site rather than two.
 *
 * Every link leaves the app, so each carries `rel="noopener noreferrer"` — a
 * target-blank link without it hands the opened page a live `window.opener`.
 */
import { useTranslation } from 'react-i18next';
import { Card, Grid, Heading, Section, Text } from '@sudobility/components';
import { RESOURCE_GROUPS, hostOf, iconFor, monogramFor } from './resource-links';

/**
 * The chip, with the site's mark in it or its initial when there is none.
 *
 * `alt=""` on purpose: the link's name is right beside it, so a screen reader
 * announcing the logo too would read every entry twice. Same for the monogram,
 * which is `aria-hidden` — it carries no information the name does not.
 */
function ResourceIcon({ icon, name }: { icon: string | undefined; name: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-black/10">
      {icon ? (
        <img src={icon} alt="" loading="lazy" className="h-6 w-6 object-contain" />
      ) : (
        <span aria-hidden="true" className="text-sm font-semibold text-neutral-500">
          {monogramFor(name)}
        </span>
      )}
    </span>
  );
}

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

      {RESOURCE_GROUPS.map((group) => (
        <Section key={group.key} spacing="lg">
          <Heading level={2} size="xl" weight="semibold">
            {t(`resources.group.${group.key}.title`)}
          </Heading>
          <Text as="p" size="sm" color="muted" className="mt-1 max-w-3xl">
            {t(`resources.group.${group.key}.route`)}
          </Text>

          <Grid cols={{ sm: 1, md: 2, lg: 3 }} gap="md" className="mt-6">
            {group.links.map((link) => (
              <Card key={link.key} variant="elevated" padding="md" className="h-full">
                <div className="flex items-start gap-3">
                  <ResourceIcon icon={iconFor(link.key)} name={link.name} />
                  <div className="min-w-0">
                    <Heading level={3} size="base" weight="semibold">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-4 hover:underline"
                      >
                        {link.name}
                      </a>
                    </Heading>
                    <Text as="p" size="xs" color="muted" className="mt-0.5 truncate">
                      {hostOf(link.url)}
                    </Text>
                  </div>
                </div>
                <Text as="p" size="sm" color="muted" className="mt-3">
                  {t(`resources.link.${link.key}`)}
                </Text>
              </Card>
            ))}
          </Grid>
        </Section>
      ))}
    </>
  );
}
