/**
 * Activates the Swiss design-system theme, as a side effect of being imported.
 *
 * It has to run before any `@sudobility/components` module is evaluated, and so
 * it is its own module, imported first by `main.tsx` (and by the test setup).
 * Several of the library's components read the theme at module load — a
 * top-level `cva()` or a constant built from `textVariants.*()`,
 * `colors.component.*` or `ui.*` — and a module that loads before
 * `configureTheme()` keeps the legacy palette for good: `Label` drew
 * `text-gray-900 dark:text-white` beside a `Heading` in `text-foreground`.
 * `main.tsx` used to import `@/app/App` ahead of `@/config/initialize`, where
 * this call lived, so the whole component tree loaded first.
 *
 * Also injects the CSS variables the semantic classes read (`:root` light and
 * `.dark`); without that style tag every `bg-background`, `text-foreground`
 * and `border-border` resolves to an undefined variable.
 */
import { configureTheme } from '@sudobility/design';
import { generateThemeCSS, swissTheme } from '@sudobility/design/themes';

configureTheme(swissTheme);

if (typeof document !== 'undefined' && !document.getElementById('sudobility-design-theme')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'sudobility-design-theme';
  styleEl.textContent = generateThemeCSS(swissTheme);
  document.head.appendChild(styleEl);
}
