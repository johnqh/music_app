import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const stub = (name: string) => fileURLToPath(new URL(`./src/stubs/${name}.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
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
    port: 5173,
  },
  // Exclude music_lib from dev-mode dep pre-bundling: esbuild's prebundle
  // doesn't process the lib's `new Worker(new URL(...))` calls, breaking the
  // MIDI/quantize workers in dev (prod builds handle them fine). Excluding
  // lets Vite transform the package per-module so worker URLs resolve; its
  // CJS deps are pre-bundled explicitly instead.
  optimizeDeps: {
    exclude: ['@sudobility/music_lib'],
    include: ['@tonejs/midi', 'dexie', 'immer', 'zustand', 'tone', 'vexflow', 'zod'],
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
        inline: [/@sudobility\/(music_lib|building_blocks|components|auth-components|design|seo_lib)/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'e2e/', 'src/test/'],
    },
  },
});
