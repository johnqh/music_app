import i18n from 'i18next';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@/i18n';
import { beforeEach } from 'vitest';
import { resetMusicPosition } from '@sudobility/music_types';
import { setEditingCopy, setLibraryMessages } from '@sudobility/music_lib';
import { buildEditingCopy } from '@/features/score-editor/command-labels';
import { libraryMessages } from '@/i18n/lib-copy';
import '@testing-library/jest-dom/vitest';

// Every language is fetched over HTTP from `public/locales/` at runtime (see
// `src/i18n.ts`), and jsdom has no server to fetch from -- so without this,
// every rendered string is its own key and any test asserting on real copy
// fails. Reading the shipped file off disk keeps those assertions honest: it is
// the same bytes the static server would hand the browser, not a fixture that
// can drift from it.
i18n.addResourceBundle(
  'en',
  'app',
  // `process.cwd()` is the project root under vitest; `import.meta.url` is not
  // a file: URL once Vite has transformed this module.
  JSON.parse(readFileSync(resolve(process.cwd(), 'public/locales/en/app.json'), 'utf8')),
  true,
  true,
);

// Editing lives in music_lib and takes its words from the host, so tests have
// to install them exactly as `initializeApp` does — otherwise every label and
// every edit-validation toast is the empty string the library deliberately
// starts with, and an assertion on that text fails for a reason that has
// nothing to do with what it is testing.
setEditingCopy(buildEditingCopy());
setLibraryMessages(libraryMessages());

// The caret is one shared position, not a store field, so it does not go away
// when a test builds a fresh store. Left over from the previous test it is a
// caret sitting wherever that one left it, which is the kind of cross-test
// leak that fails only in a full run.
beforeEach(() => {
  resetMusicPosition();
});

// jsdom does not implement SVGElement.prototype.getBBox, but VexFlow (used by
// src/adapters/vexflow) calls it both internally (text measurement) and from
// our own id-map bbox lookups. Stub it with a zeroed box so VexFlow can render
// to SVG in jsdom-based tests; geometry assertions are out of scope for those
// tests (jsdom has no layout engine), only DOM structure is asserted.
if (typeof SVGGraphicsElement !== 'undefined' && !SVGGraphicsElement.prototype.getBBox) {
  Object.defineProperty(SVGGraphicsElement.prototype, 'getBBox', {
    value: (): DOMRect => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      toJSON: () => ({}),
    }),
    writable: true,
    configurable: true,
  });
}

// jsdom does not implement the Pointer Capture APIs, which MUI's <Slider>
// (used throughout src/components/layout, src/components/inspector) calls
// unconditionally while handling a pointerdown/pointerup drag (only
// `setPointerCapture` itself is guarded, in application code, against
// throwing -- `hasPointerCapture`/`releasePointerCapture` aren't, and would
// otherwise throw "not a function" the moment a test simulates a real
// pointer-drag interaction, e.g. src/test/drag-slider.ts).
for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
  if (typeof Element !== 'undefined' && !Element.prototype[method]) {
    Object.defineProperty(Element.prototype, method, {
      value: (): boolean => false,
      writable: true,
      configurable: true,
    });
  }
}

// jsdom does not implement Element.scrollIntoView, which @sudobility/
// components' Radix-backed Select calls unconditionally while positioning
// the open listbox against the currently-selected item (library sweep 1:
// TransportBar/EditorToolbar/PianoRollToolbar/TrackPanel/InspectorPanel's
// selects). Without this, opening any of those selects in a test throws
// "scrollIntoView is not a function" from inside Radix's own effect.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: (): void => {},
    writable: true,
    configurable: true,
  });
}

// jsdom has no canvas implementation: `HTMLCanvasElement.getContext('2d')`
// returns null. The canvas notation renderer (CanvasScoreRenderer +
// paintHighlights) draws through whatever 2D context the element hands
// back, so give every canvas a persistent recording mock (music_lib's
// createMock2DContext — the same double the lib's own renderer tests use).
// One context per canvas element, matching real browser semantics where
// repeated getContext('2d') calls return the same object.
import { createMock2DContext } from '@sudobility/music_lib';

if (typeof HTMLCanvasElement !== 'undefined') {
  const mockContexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof createMock2DContext>>();
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value(this: HTMLCanvasElement) {
      let ctx = mockContexts.get(this);
      if (!ctx) {
        ctx = createMock2DContext(this.width || 800, this.height || 600);
        mockContexts.set(this, ctx);
        Object.defineProperty(ctx, 'canvas', { value: this, configurable: true });
      }
      return ctx;
    },
  });
}
