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
  // Exclude music_lib from dev-mode dep pre-bundling: esbuild's prebundle
  // doesn't process the lib's `new Worker(new URL(...))` calls, breaking the
  // MIDI/quantize workers in dev (prod builds handle them fine). Excluding
  // lets Vite transform the package per-module so worker URLs resolve; its
  // CJS deps are pre-bundled explicitly instead.
  optimizeDeps: {
    // esbuild's dep pre-bundler does not handle `new Worker(new URL(...))`,
    // which music_lib uses for MIDI import and quantize.
    exclude: ['@sudobility/music_lib', '@sudobility/music_io'],
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
    /*
      RTL + userEvent typing across a real store is slow under full-suite load.

      15s was not enough for the three generation-polling specs — `router`,
      `DashboardPage` and `ScoreEditorView` — which drive a job through several
      poll intervals with fake timers *and* real user typing. They passed in
      isolation and failed intermittently in a full run, which is the worst
      shape of flake: a green suite that is not actually a green suite.

      Raised rather than the specs being sped up because the time is real work
      (a whole editor mounts and a job is polled to completion), not a hang —
      and a test that is slow is cheaper to keep than one that is quietly
      unreliable.
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
