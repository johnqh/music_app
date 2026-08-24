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
  'src/i18n/lib-copy.ts',
  // Theme application: reads and writes the document, so it is UI.
  'src/app/theme.ts',
  // Command labels are UI copy, keyed by the commands they name.
  'src/features/score-editor/command-labels.ts',
  // Geometry that turns pointer coordinates into score positions. It reads a
  // LayoutPlan, which is music_lib's, but everything it does is answer
  // questions about a pointer — see hit-test.ts's own doc.
  'src/features/score-editor/hit-test.ts',
  'src/features/score-editor/track-gutter.ts',
  'src/features/score-editor/autoscroll.ts',
  'src/features/score-editor/playback-scroll.ts',
  'src/features/score-editor/note-colors.ts',
  'src/features/score-editor/render-theme.ts',
  'src/features/score-editor/note-drag.ts',
  'src/features/print/print-layout.ts',
  'src/features/piano-keyboard/keyboard-geometry.ts',
  'src/features/piano-keyboard/playing-pitches.ts',
  // Display formatting for a control's readout.
  'src/features/tracks/pan-readout.ts',
  // The inspector's shared vocabulary: the MIXED sentinel and the class names
  // that keep a column of controls the same height. Presentation, not logic.
  'src/components/inspector/shared.ts',
  // The app bar's menu hook and button classes — a React hook and class
  // strings, so UI by definition.
  'src/components/layout/app-bar-menu.ts',
  // Dispatch helpers: they wire UI events to music_lib commands.
  //
  // `editing.ts` is no longer among them — it was 834 lines of editing logic
  // sitting in the UI package under this exemption, and it now lives in
  // music_lib where a second app can reach it. The rest are on the same path.
  'src/features/score-editor/clipboard-prompts.ts',
  'src/features/score-editor/tracker-export.ts',
  'src/features/score-editor/chord-entry.ts',
  'src/context/pageConfigContextDef.ts',
  // Maps an API refusal onto the dialog that answers it — UI wiring, and it
  // imports the dialog it opens.
  'src/features/credits/report-generation-error.ts',
  // Build-time configuration and the language list the picker offers.
  'src/config/constants.ts',
  'src/config/languages.ts',
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
});
