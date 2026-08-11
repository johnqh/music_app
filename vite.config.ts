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
    // Both, and for the same reason: esbuild's dep pre-bundler does not handle
    // `new Worker(new URL(...))`, which music_lib uses for MIDI import and
    // quantize, and music_io now uses for the Basic Pitch model.
    exclude: ['@sudobility/music_lib', '@sudobility/music_io'],
    // No `dexie`: it went with the IndexedDB persistence the server-backed
    // store replaced, and naming an uninstalled package here makes Vite log a
    // resolve failure on every dev start.
    // basic-pitch and tfjs are listed explicitly because music_io is excluded
    // above: excluding a package also stops Vite pre-bundling what it imports,
    // and both of these ship CommonJS that fails in a module worker with
    // "module is not defined".
    include: [
      '@tonejs/midi',
      'immer',
      'zustand',
      'tone',
      'vexflow',
      'zod',
      '@spotify/basic-pitch',
      '@tensorflow/tfjs',
    ],
  },
  test: {
    environment: 'jsdom',
    // RTL + userEvent typing across a real store is slow under full-suite load
    testTimeout: 15000,
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    exclude: ['node_modules', 'dist', 'e2e'],
    // music_lib ships ESM that imports CJS deps (@tonejs/midi); Node's ESM
    // loader can't interop those named imports, so let vite transform the
    // package instead of externalizing it.
    server: {
      deps: {
        inline: [
          /@sudobility\/(music_lib|building_blocks|components|auth-components|design|seo_lib)/,
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
