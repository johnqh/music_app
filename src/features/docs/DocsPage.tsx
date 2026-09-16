/**
 * The documentation, as master and detail.
 *
 * The list of topics is the master and stays put while a topic scrolls, which
 * is what makes a reference readable: you can see where you are in the whole
 * without losing your place in the part. Below `md` the list becomes a
 * scrollable strip above the content instead of a column beside it — a
 * sidebar on a phone would leave the prose about a third of the screen wide.
 *
 * The URL carries the topic (`/en/docs/instruments`), so a link into one
 * section is shareable and the back button steps between topics. `/en/docs`
 * with no topic shows the first one rather than an empty pane.
 *
 * Prose comes from the locale files through `DOCS_TOPICS`; the reference
 * tables come from the code. See `docs-content.ts` for why the split.
 */
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router-dom';
import { Heading, Section, Text } from '@sudobility/components';
import { LocalizedLink } from '@/components/layout/LocalizedLink';
import { useCurrentLanguage } from '@/hooks/useLocalizedNavigate';
import { DOCS_TOPICS, docsGroupLabelKey, docsTopic } from '@sudobility/music_lib';
import { DOCS_GROUPS, type DocsGroup } from '@sudobility/music_types';
import { InstrumentReference } from './InstrumentReference';
import { ShortcutReference } from './ShortcutReference';
import { FormatReference } from './FormatReference';

function TopicList({ activeId }: { activeId: string }) {
  const { t } = useTranslation();
  const lang = useCurrentLanguage();

  return (
    <nav aria-label={t('docs.navLabel')} className="flex flex-col gap-6">
      {DOCS_GROUPS.map((group: DocsGroup) => {
        const topics = DOCS_TOPICS.filter((topic) => topic.group === group);
        if (topics.length === 0) return null;
        return (
          <div key={group} className="flex flex-col gap-1">
            <Text
              as="p"
              size="xs"
              weight="medium"
              color="muted"
              className="uppercase tracking-wide"
            >
              {t(docsGroupLabelKey(group))}
            </Text>
            {topics.map((topic) => {
              const isActive = topic.id === activeId;
              return (
                <LocalizedLink
                  key={topic.id}
                  to={`/${lang}/docs/${topic.id}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={[
                    'rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-theme-surface-hover font-medium text-theme-text'
                      : 'text-theme-text-secondary hover:bg-theme-surface-hover',
                  ].join(' ')}
                >
                  {t(topic.title)}
                </LocalizedLink>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

export function DocsPage() {
  const { t } = useTranslation();
  const { topicId } = useParams<{ topicId?: string }>();
  const lang = useCurrentLanguage();

  // No topic means the first one, not an empty pane.
  if (!topicId) {
    return <Navigate to={`/${lang}/docs/${DOCS_TOPICS[0].id}`} replace />;
  }

  const topic = docsTopic(topicId);
  // An unknown topic is a stale link, not an error page: send it to the front.
  if (!topic) return <Navigate to={`/${lang}/docs`} replace />;

  return (
    <Section className="w-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 md:flex-row md:gap-10">
        <aside className="md:w-64 md:shrink-0">
          <div className="md:sticky md:top-24">
            <Heading level={1} className="mb-4 text-xl">
              {t('docs.title')}
            </Heading>
            <TopicList activeId={topic.id} />
          </div>
        </aside>

        <article className="min-w-0 flex-1">
          <Heading level={2} className="text-2xl">
            {t(topic.title)}
          </Heading>
          <Text as="p" color="muted" className="mt-2">
            {t(topic.summary)}
          </Text>

          {topic.sections.map((section) => (
            <section key={section.heading} className="mt-8">
              <Heading level={3} className="text-lg">
                {t(section.heading)}
              </Heading>
              {section.body.map((paragraph) => (
                <Text as="p" key={paragraph} className="mt-3 leading-relaxed">
                  {t(paragraph)}
                </Text>
              ))}
            </section>
          ))}

          {topic.widget === 'shortcuts' && (
            <div className="mt-8">
              <ShortcutReference />
            </div>
          )}
          {topic.widget === 'instruments' && (
            <div className="mt-8">
              <InstrumentReference />
            </div>
          )}
          {topic.widget === 'formats' && (
            <div className="mt-8">
              <FormatReference />
            </div>
          )}
        </article>
      </div>
    </Section>
  );
}
