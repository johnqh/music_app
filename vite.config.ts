import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const stub = (name: string) => fileURLToPath(new URL(`./src/stubs/${name}.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Single instance of each of these regardless of how @sudobility/music_lib
    // is resolved. Normally it comes from the registry with no nested copies,
    // but a local `bun link` during cross-repo development exposes music_lib's
    // own dev-installed react/zustand — two React instances then break every
    // hook ("Cannot read properties of null (reading 'useCallback')").
    dedupe: ['react', 'react-dom', 'zustand'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Stub out @sudobility/building_blocks' optional peer deps we don't
      // install (sudobility landing "stubs system" — see its CLAUDE.md).
      '@sudobility/subscription-components': stub('subscription-components'),
      '@sudobility/devops-components': stub('devops-components'),
      '@sudobility/subscription_lib': stub('subscription_lib'),
    },
  },
  server: {
    port: 5039,
  },
  build: {
    // Never inline the Resources page's site icons.
    //
    // Vite base64s any asset under 4KB into the JS, and most of these are 16
    // or 32px favicons that fall well under it — 25 of the 38 did, adding
    // ~49KB to the main bundle. There is no route-level code splitting here,
    // so that lands on every visitor to pay for one page few of them open, and
    // base64 gzips worse than the bytes it encodes. As emitted files they are
    // fetched only by the page that shows them, and cached separately from the
    // app.
    assetsInlineLimit: (filePath: string) =>
      filePath.includes('resource-icons') ? false : undefined,
  },
  // Exclude music_lib from dev-mode dep pre-bundling: esbuild's prebundle
  // doesn't process the lib's `new Worker(new URL(...))` calls, breaking the
  // MIDI/quantize workers in dev (prod builds handle them fine). Excluding
  // lets Vite transform the package per-module so worker URLs resolve; its
  // CJS deps are pre-bundled explicitly instead.
  optimizeDeps: {
    // esbuild's dep pre-bundler does not handle `new Worker(new URL(...))`,
    // which music_lib uses for MIDI import and quantize.
    exclude: [
      '@sudobility/music_lib',
      '@sudobility/music_io',
      // music_player for the same reason and one of its own: its web entry
      // lazily `import('js-synthesizer')`, and the pre-bundler resolves that
      // eagerly into a chunk whose worklet asset URLs no longer point where the
      // app serves them.
      '@sudobility/music_player',
    ],
    // No `dexie`: it went with the IndexedDB persistence the server-backed
    // store replaced, and naming an uninstalled package here makes Vite log a
    // resolve failure on every dev start.
    // No `tone`: the soundfont engine replaced Tone.js and the dependency is
    // gone. Vite only re-resolves this list when the lockfile changes, so a
    // stale entry here sits harmless for weeks and then fails a dev start that
    // has nothing to do with whatever changed. `@tonejs/midi` is unrelated to
    // `tone` and is still a real dependency.
    include: ['@tonejs/midi', 'immer', 'zustand', 'vexflow', 'zod'],
  },
  test: {
    environment: 'jsdom',
    // jsdom only exposes localStorage for a document with a real origin.
    // Node's newer localStorage warning is otherwise surfaced as an undefined
    // window.localStorage in tests that exercise device preferences.
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    /*
      Worker startup, not test speed, is what made this suite unreliable.

      Vitest's `forks` pool sizes itself from the core count, and each worker
      here is a jsdom document plus a whole editor. On an 8-core machine that
      is enough concurrent heavyweight processes that some never finish
      starting, and the run dies with

          [vitest-pool]: Failed to start forks worker for <file>
          Caused by: Timeout waiting for worker to respond

      — which surfaces as an arbitrary test "failing" and passing on a rerun.
      It cost a release: `push_all` stopped on music_app with `Tests failed`
      while every file passed in isolation.

      Capped at half the cores so a build or a second suite running alongside
      still has room. It costs some wall-clock and buys a suite whose green is
      worth believing.
    */
    pool: 'forks',
    maxWorkers: 4,
    /*
      Generous, but not the fix for the above: the generation specs drive a job
      through several poll intervals with real user typing, and a whole editor
      mounts to do it. A slow test is cheaper to keep than a quietly unreliable
      one, and 30s still fails a genuine hang as a hang.
    */
    testTimeout: 30000,
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    exclude: ['node_modules', 'dist', 'e2e'],
    // Two reasons to inline, both the same shape: Node's ESM loader is
    // stricter than what these packages are built for.
    //
    // music_lib ships ESM that imports CJS deps (@tonejs/midi), whose named
    // imports Node cannot interop. consumables_client is compiled by tsc with
    // extensionless relative imports -- the house style it shares with
    // entity_client -- which Node rejects as ERR_UNSUPPORTED_DIR_IMPORT. The
    // browser never sees either problem, because Vite resolves both; only
    // vitest, which hands bare dependencies to Node, does.
    //
    // consumables_pages needs no entry: it is Vite-bundled like entity_pages,
    // so its output has no relative imports at all.
    server: {
      deps: {
        inline: [
          /@sudobility\/(music_lib|building_blocks|components|auth-components|design|seo_lib)/,
          /@sudobility\/consumables_client/,
        ],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'e2e/', 'src/test/'],
    },
  },
});
