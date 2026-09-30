/**
 * Which documentation topics have a figure, and how large it is drawn.
 *
 * A `Record` over the topic vocabulary, not a list of the topics that have
 * one: a topic added to `DOCS_TOPIC_IDS` fails to compile here until somebody
 * decides whether it gets a picture. `null` is that decision made — the
 * reference topics are tables built from live data, and a picture of a table
 * is a copy of it that goes stale.
 *
 * The sizes are CSS pixels. The files are captured at twice that density
 * (`scripts/capture-docs-figures.mjs`), and stating the size here is what lets
 * the page reserve the room before the image arrives, so the prose under a
 * figure does not jump when it does. `figures.test.ts` reads each file's
 * header and holds this table to it.
 *
 * The description is a locale key, `docs.<topic>.figure`, and the same words
 * in both apps: it says what the element is, not which app drew it.
 */
import type { DocsTopicId } from '@sudobility/music_types';

export type DocsFigure = {
  /** Width in CSS pixels; the file is twice this. */
  width: number;
  /** Height in CSS pixels; the file is twice this. */
  height: number;
};

export const DOCS_FIGURES: Record<DocsTopicId, DocsFigure | null> = {
  'getting-started': { width: 672, height: 526 },
  navigation: { width: 900, height: 57 },
  editor: { width: 900, height: 310 },
  notation: { width: 900, height: 40 },
  structure: { width: 280, height: 852 },
  tracks: { width: 280, height: 620 },
  playback: { width: 900, height: 41 },
  'midi-input': { width: 900, height: 189 },
  inspector: { width: 280, height: 852 },
  generation: { width: 672, height: 926 },
  sharing: { width: 262, height: 142 },
  settings: { width: 1100, height: 480 },
  shortcuts: null,
  instruments: null,
  formats: null,
  limits: null,
};

/** Where a topic's figure is served from, under the app's base path. */
export function docsFigureUrl(topic: DocsTopicId, base: string = import.meta.env.BASE_URL): string {
  return `${base.replace(/\/$/, '')}/docs/figures/${topic}.png`;
}

/** The locale key for what a topic's figure shows. */
export function docsFigureLabelKey(topic: DocsTopicId): string {
  return `docs.${topic}.figure`;
}
