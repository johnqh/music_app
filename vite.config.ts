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
    include: ['@tonejs/midi', 'immer', 'zustand', 'tone', 'vexflow', 'zod'],
  },
  test: {
    environment: 'jsdom',
    // RTL + userEvent typing across a real store is slow under full-suite load
    testTimeout: 15000,
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
