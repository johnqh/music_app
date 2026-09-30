/**
 * The documentation, as master and detail.
 *
 * The list of topics is the master and stays put while a topic scrolls, which
 * is what makes a reference readable: you can see where you are in the whole
 * without losing your place in the part. The layout is the library's
 * `MasterDetailLayout`, through `MasterDetailPage` as the dashboard's is — so
 * the pages split, scroll and collapse the same way. Below `md` it shows
 * one pane at a time: the topic, with a back button to the list.
 *
 * The URL carries the topic (`/en/docs/instruments`), so a link into one
 * section is shareable and the back button steps between topics. `/en/docs`
 * with no topic shows the first one rather than an empty pane.
 *
 * `detailTitle` is deliberately not passed: the layout marks the master
 * `aria-hidden` whenever it has one, which would take the topic list away
 * from a screen reader. The topic's heading is rendered here instead.
 *
 * A topic about the interface opens with a figure of the element it is about
 * (`figures.ts`): the element alone, not the screen it sits on, so it is
 * legible at the width of the column. It is drawn at its own size and never
 * larger — a picture of a toolbar stretched to fill the column is a picture
 * of a toolbar that does not exist.
 *
 * Prose comes from the locale files through `DOCS_TOPICS`; the reference
 * tables come from the code. See `docs-content.ts` for why the split.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router-dom';
import { Heading, Text } from '@sudobility/components';
import { MasterDetailPage } from '@/components/layout/MasterDetailPage';
import { LocalizedLink } from '@/components/layout/LocalizedLink';
import { useCurrentLanguage } from '@/hooks/useLocalizedNavigate';
import { DOCS_TOPICS, docsGroupLabelKey, docsTopic } from '@/app-library';
import { DOCS_GROUPS, type DocsGroup } from '@sudobility/music_types';
import { InstrumentReference } from './InstrumentReference';
import { ShortcutReference } from './ShortcutReference';
import { FormatReference } from './FormatReference';
import { DOCS_FIGURES, docsFigureLabelKey, docsFigureUrl } from './figures';

function TopicList({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const lang = useCurrentLanguage();

  return (
    <nav aria-label={t('docs.navLabel')} className="flex flex-col gap-6 p-3">
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
                  onClick={() => onSelect(topic.id)}
                  className={[
                    'rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted',
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
  // Which pane a narrow screen shows. A URL always names a topic, so it shows
  // the topic unless the reader asked for the list — and that answer is kept
  // with the topic it was given for, so opening another one shows it.
  const [listShownFor, setListShownFor] = useState<string | null>(null);

  // No topic means the first one, not an empty pane.
  if (!topicId) {
    return <Navigate to={`/${lang}/docs/${DOCS_TOPICS[0].id}`} replace />;
  }

  const topic = docsTopic(topicId);
  // An unknown topic is a stale link, not an error page: send it to the front.
  if (!topic) return <Navigate to={`/${lang}/docs`} replace />;
  const figure = DOCS_FIGURES[topic.id];

  return (
    <MasterDetailPage
      masterTitle={t('docs.title')}
      masterContent={<TopicList activeId={topic.id} onSelect={() => setListShownFor(null)} />}
      detailContent={
        <article className="min-w-0">
          <Heading level={1} className="text-2xl">
            {t(topic.title)}
          </Heading>
          <Text as="p" color="muted" className="mt-2">
            {t(topic.summary)}
          </Text>

          {figure && (
            <figure className="mt-6">
              <img
                src={docsFigureUrl(topic.id)}
                // The caption below says what this is; saying it here too
                // reads it to a screen reader twice.
                alt=""
                width={figure.width}
                height={figure.height}
                loading="lazy"
                className="h-auto max-w-full border border-border"
              />
              <figcaption className="mt-2 text-sm text-muted-foreground">
                {t(docsFigureLabelKey(topic.id))}
              </figcaption>
            </figure>
          )}

          {topic.sections.map((section) => (
            <section key={section.heading} className="mt-8">
              <Heading level={2} className="text-lg">
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
      }
      mobileView={listShownFor === topic.id ? 'navigation' : 'content'}
      onBackToNavigation={() => setListShownFor(topic.id)}
      contentKey={topic.id}
    />
  );
}
