/**
 * Serializes the notation icons into platform-neutral shape data.
 *
 * Rendered rather than transcribed: the components compute their paths from
 * shared geometry constants and template literals, so copying them by hand
 * would be hundreds of lines of opportunity to get a number wrong. Rendering
 * them and reading the output is exact by construction, and re-running this
 * after an icon changes regenerates the data rather than inviting a second
 * edit that drifts.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import * as icons from '../src/components/icons/notation-icons.tsx';

const names = Object.keys(icons)
  .filter((k) => /Icon$/.test(k) && typeof icons[k] === 'function')
  .sort();

const out = {};
for (const name of names) {
  out[name] = renderToStaticMarkup(createElement(icons[name]));
}
process.stdout.write(JSON.stringify(out, null, 1));
