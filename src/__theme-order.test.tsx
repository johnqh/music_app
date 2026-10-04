/**
 * The design-system theme is active before any library module loads.
 *
 * Several `@sudobility/components` modules read the theme when they are
 * evaluated, not when they render — a top-level `cva()` or a constant built
 * from `textVariants.*()` — and keep whatever palette was in force then.
 * `main.tsx` used to import `@/app/App` ahead of the module that called
 * `configureTheme`, so `Label` drew `text-gray-900 dark:text-white` (black in
 * light, white in dark, never the theme's foreground) beside a `Heading` in
 * `text-foreground`. Nothing else could see it: the class names are both
 * plausible, and jsdom computes no colours.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { Label } from '@sudobility/components';

/** The specifiers a module imports, in source order, comments removed. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  return [...source.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map(
    (match) => match[1],
  );
}

describe('theme order', () => {
  it('imports the theme first in the entry point', () => {
    // Imports are hoisted above every statement, so only their order counts.
    expect(importsOf('src/main.tsx')[0]).toBe('@/config/theme');
  });

  it('imports the theme first in the test setup, as the app does', () => {
    expect(importsOf('src/test/setup.ts')[0]).toBe('@/config/theme');
  });

  it('draws a load-time themed library component in the theme’s colours', () => {
    render(<Label>Name</Label>);
    const label = screen.getByText('Name');
    expect(label).toHaveClass('text-foreground');
    expect(label.className).not.toMatch(/gray-\d/);
  });
});
