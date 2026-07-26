/**
 * Settings page: theme mode (light/dark/system, persisted as device prefs
 * via App's persist effect) and developer mode. Tailwind + design tokens.
 *
 * Adopts `@sudobility/components` controls (library sweep 2): the theme
 * pills stay `role="radio"` buttons (a real ARIA `radiogroup`, not a
 * library `Select`/`ToggleGroup` -- neither reproduces that exact role
 * triad), but use the library `Button` as the underlying element, which
 * forwards `role`/`aria-checked` unchanged; the developer-mode checkbox
 * becomes the library `Checkbox`.
 */
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Section } from '@sudobility/components';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';

export type SettingsPageProps = { store?: EditorStoreApi };

const THEME_OPTIONS = ['light', 'dark', 'system'] as const;

export default function SettingsPage({ store = useAppStore }: SettingsPageProps) {
  const { t } = useTranslation();
  const themeMode = store((s) => s.themeMode);
  const developerMode = store((s) => s.developerMode);

  return (
    <Section spacing="xl">
      <h1 className="text-2xl font-semibold text-theme-text-primary">{t('settings.title')}</h1>

      <div className="mt-6 max-w-md space-y-6">
        <div>
          <span className="block text-sm font-medium text-theme-text-primary">
            {t('settings.theme')}
          </span>
          <div className="mt-2 flex gap-2" role="radiogroup" aria-label={t('settings.theme')}>
            {THEME_OPTIONS.map((mode) => (
              <Button
                key={mode}
                type="button"
                role="radio"
                aria-checked={themeMode === mode}
                variant={themeMode === mode ? 'primary' : 'outline'}
                size="sm"
                className="h-auto text-sm"
                onClick={() => store.getState().setThemeMode(mode)}
              >
                {t(`settings.theme${mode.charAt(0).toUpperCase()}${mode.slice(1)}` as never)}
              </Button>
            ))}
          </div>
        </div>

        <Checkbox
          label={t('settings.developerMode')}
          checked={developerMode}
          onChange={(checked) => store.getState().setDeveloperMode(checked)}
        />
      </div>
    </Section>
  );
}
