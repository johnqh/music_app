/**
 * music_app holds UI, and only UI.
 *
 * Everything else has a home: `music_types` for the model and its primitives,
 * `music_codecs` for note-file formats, `music_client` for the API,
 * `music_io` for playback and audio files, `music_lib` for business logic.
 * The rule earns its keep the moment a second consumer appears — a React
 * Native app, or the server — because logic that grew here has to be moved
 * before either can use it, and by then it has usually grown a dependency on
 * something UI-shaped.
 *
 * Seven modules had already drifted in (`note-entry`, `lyric-syllables`,
 * `duration-modifiers`, `duration-selection`, `range-select`, `pitch-drag`,
 * `snapshot-tree`) — none touching React, the DOM or layout geometry. They now
 * live in music_lib, and this stops the next one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * Files exempt from the rule, with the reason.
 *
 * Kept as an explicit list rather than a pattern, so adding one is a decision
 * somebody makes on purpose.
 */
const ALLOWED_NON_UI = new Set([
  // The composition root: it *constructs* the platform services rather than
  // implementing them, which is exactly music_app's job.
  'src/config/initialize.ts',
  // i18n wiring and the copy the library's warnings are phrased in.
  'src/i18n.ts',
  'src/i18n/library-copy.ts',
  // Theme application: reads and writes the document, so it is UI.
  'src/app/theme.ts',
  // The formats named on the documentation page, with the copy key that
  // describes each. What the app can actually read and write lives in
  // music_io; this is the list a reader is shown.
  'src/features/docs/formats.ts',
  // The links the Resources page lists, with the copy key describing each.
  // A list of other people's URLs and the i18n keys beside them: page content,
  // and the only thing music-shaped about it is which importer each feeds.
  'src/pages/resource-links.ts',
  // App layout geometry, which is this app's rather than the canvas's:
  // a pointer near the edge of a *scroll box* and the per-frame scroll delta
  // that follows. Canvas geometry — anything that reasons about the drawn
  // score — belongs to music_drawing instead; see CLAUDE.md.
  'src/features/score-editor/autoscroll.ts',
  // The browser's `ScoreCanvasSurface`: a 2D context, a caret <div> moved by
  // requestAnimationFrame, and a scroll box. It computes no geometry — it
  // replays what music_drawing's `ScoreCanvas` hands it — and it is the part
  // that cannot live in a platform-free package, because it touches the DOM.
  'src/features/score-editor/web-canvas-surface.ts',
  // The inspector's shared vocabulary: the MIXED sentinel and the class names
  // that keep a column of controls the same height. Presentation, not logic.
  'src/components/inspector/shared.ts',
  // The app bar's menu hook and button classes — a React hook and class
  // strings, so UI by definition.
  'src/components/layout/app-bar-menu.ts',
  // One class string: the casing of a field whose text is kept as typed.
  // Presentation, and shared so three dialogs cannot state it three ways.
  'src/components/controls/input-classes.ts',
  // Which documentation topics have a figure, and where it is served from.
  // This app's own pictures of this app's own screens.
  'src/features/docs/figures.ts',
  // The "dispatch helpers" exemption is gone, and so are the four modules that
  // sat under it. `editing.ts` was 834 lines of editing logic in the UI
  // package; `clipboard-prompts.ts` was pure score rules about when cut and
  // paste need to ask. Both now live where a second app can reach them, and
  // nothing has been added back.
  'src/context/pageConfigContextDef.ts',
  // The breadcrumb page-override context `useSetBreadcrumbs` reads and
  // writes — the same shape `pageConfigContextDef.ts` above is, and for the
  // same reason: a `createContext` call carries no logic of its own to move
  // anywhere else.
  'src/context/breadcrumbContextDef.ts',
  // Maps an API refusal onto the dialog that answers it — UI wiring, and it
  // imports the dialog it opens.
  'src/features/credits/report-generation-error.ts',
  // Build-time configuration and the language list the picker offers.
  'src/config/constants.ts',
  'src/config/languages.ts',
  // Composition facade: combines business, editor, and app services for the UI.
  'src/app-library.ts',
]);

/** Every shipped `.ts` file that is not a component, hook, or test. */
function plainModules(): string[] {
  return (
    globSync('src/**/*.ts', { cwd: process.cwd() })
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => !f.includes('.test.'))
      .filter((f) => !f.endsWith('.d.ts'))
      .filter((f) => !f.startsWith('src/test/'))
      .filter((f) => !f.startsWith('src/stubs/'))
      // App infrastructure is deliberately composed here: it owns the
      // browser store, persistence, playback binding, and error boundary.
      .filter((f) => !f.startsWith('src/store/'))
      .filter((f) => !f.startsWith('src/services/'))
      // A `use*` module is a React hook by convention, so it is UI by definition.
      .filter((f) => !/\/use[A-Z]/.test(f))
  );
}

describe('music_app holds UI only', () => {
  it('finds modules to check', () => {
    // Guards the glob: an empty list would make the assertion below vacuous.
    expect(plainModules().length).toBeGreaterThan(5);
  });

  it('has no plain logic module outside the allowed list', () => {
    const unexpected = plainModules().filter((f) => !ALLOWED_NON_UI.has(f));

    expect(
      unexpected,
      'These are plain .ts modules in the UI package. If one is business ' +
        'logic it belongs in music_lib (or music_types/music_codecs/music_io); ' +
        'if it is genuinely UI, add it to ALLOWED_NON_UI with the reason.',
    ).toEqual([]);
  });

  it('never reaches into another package’s internals', () => {
    /*
      A deep import bypasses the package's own entry point, which is where its
      contract lives, and silently couples us to its file layout.

      Checked against each package's **declared** `exports` rather than a
      pattern: music_io publishes `/web`, `/rn`, `/mocks` and two `/rn/*`
      tables on purpose, and a hand-written allow-list of those would go stale
      the moment the package adds one. Anything not in the map is a reach.
    */
    const declared = new Map<string, Set<string>>();
    const subpathImport = /from '(@sudobility\/music_[a-z]+)(\/[^']+)'/g;
    const offenders: string[] = [];

    for (const file of globSync('src/**/*.{ts,tsx}', { cwd: process.cwd() })) {
      const source = readFileSync(file, 'utf8');
      for (const [, pkg, subpath] of source.matchAll(subpathImport)) {
        if (!declared.has(pkg)) {
          const manifest = JSON.parse(readFileSync(`node_modules/${pkg}/package.json`, 'utf8')) as {
            exports?: Record<string, unknown>;
          };
          declared.set(pkg, new Set(Object.keys(manifest.exports ?? {})));
        }
        if (!declared.get(pkg)!.has(`.${subpath}`)) {
          offenders.push(`${file}: ${pkg}${subpath}`);
        }
      }
    }

    expect(
      offenders,
      'These import a path the package does not declare in its exports map.',
    ).toEqual([]);
  });
});

/**
 * Editing lives in music_lib, and the UI only invokes it.
 *
 * The rule that makes a second app possible: a user action calls one function,
 * and the decisions behind it — which command, what target, what happens when
 * the selection is a chord rather than a note — belong where both apps can
 * reach them. `editing.ts` used to sit in this package under an exemption in
 * the list above, 834 lines of it, and the components around it had grown
 * loops and branches of their own: a chord-edit loop in the piano keyboard, a
 * four-call sequence behind a click on the stave, a per-measure dispatch loop
 * in the inspector.
 *
 * Dispatching a command is the visible edge of all of that, so it is what this
 * guards. A component that needs something the facade cannot express should
 * gain a function in music_lib rather than an exception here.
 */
describe('music_app invokes editing rather than performing it', () => {
  const sources = () =>
    globSync('src/**/*.{ts,tsx}', { cwd: process.cwd() }).filter(
      (f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'),
    );

  it('finds sources to check', () => {
    // Guards the glob: an empty list would make the assertion below vacuous.
    expect(sources().length).toBeGreaterThan(20);
  });

  it('never dispatches a score command itself', () => {
    const offenders = sources().filter((file) =>
      // `.dispatchCommand(` — the call, not the word in a comment explaining
      // why something does not use it.
      /\.dispatchCommand\(/.test(readFileSync(file, 'utf8')),
    );

    expect(
      offenders,
      'These dispatch a command from the UI package. An edit belongs in ' +
        "music_lib's editing module, called from here as a single function, " +
        'so a React Native app obeys the same rules rather than repeating them.',
    ).toEqual([]);
  });

  it('never imports score command factories into UI code', () => {
    const offenders: string[] = [];
    const commandImport =
      /import\s+(?:type\s+)?\{(?<names>[^}]+)\}\s+from\s+'@sudobility\/(?:music_lib|music_types)'/gs;

    for (const file of sources()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(commandImport)) {
        const names = match
          .groups!.names.split(',')
          .map((part) =>
            part
              .trim()
              .split(/\s+as\s+/)[0]
              ?.trim(),
          )
          .filter((name): name is string => Boolean(name));

        for (const name of names) {
          if (name === 'dispatchTracked' || /Command$/.test(name)) {
            offenders.push(`${file}: ${name}`);
          }
        }
      }
    }

    expect(
      offenders,
      'These import command factories into the UI package. Add a facade in ' +
        'music_lib instead, then call that from React/RN.',
    ).toEqual([]);
  });
});
