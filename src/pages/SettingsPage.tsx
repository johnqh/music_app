/**
 * Settings page: theme mode (light/dark/system, persisted as device prefs
 * via App's persist effect) and developer mode. Tailwind + design tokens.
 */
import { useTranslation } from 'react-i18next';
import { Section, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
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
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={themeMode === mode}
                className={cn(
                  themeMode === mode ? variants.button.primary.small() : variants.button.outline.small(),
                  'h-auto text-sm',
                )}
                onClick={() => store.getState().setThemeMode(mode)}
              >
                {t(`settings.theme${mode.charAt(0).toUpperCase()}${mode.slice(1)}` as never)}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={developerMode}
            aria-label={t('settings.developerMode')}
            onChange={(e) => store.getState().setDeveloperMode(e.target.checked)}
          />
          <span className="text-sm text-theme-text-primary">{t('settings.developerMode')}</span>
        </label>
      </div>
    </Section>
  );
}
