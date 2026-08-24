/**
 * Settings, built on the library's `GlobalSettingsPage` — the same component
 * `sudojo_app` renders, so the two apps present settings identically: a
 * master-detail layout whose first section is Appearance (theme and font
 * size), with app-specific sections after it.
 *
 * Theme stays on the app store rather than moving to the shared
 * `ThemeProvider`: the score renderer, the piano keyboard and the app menu all
 * read `themeMode` to choose their render palettes, and the store's values
 * (`light` | `dark` | `system`) are already exactly the library's `Theme`
 * enum, so this needs an adapter and no migration. Font size is new and has no
 * such consumers, so it lives in `useFontSize`.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, Section, Stack, Switch, Text } from '@sudobility/components';
import { GlobalSettingsPage, type SettingsSectionConfig } from '@sudobility/building_blocks';
import { useAppStore } from '@sudobility/music_lib';
import { MusicalNoteIcon } from '@heroicons/react/24/outline';
import { useFontSize, type FontSizePref } from '@/hooks/useFontSize';
import type { EditorStoreApi } from '@sudobility/music_lib';

export type SettingsPageProps = { store?: EditorStoreApi };

export default function SettingsPage({ store = useAppStore }: SettingsPageProps) {
  const { t } = useTranslation();
  const themeMode = store((s) => s.themeMode);
  const developerMode = store((s) => s.developerMode);
  const pitchDisplay = store((s) => s.pitchDisplay);
  const { fontSize, setFontSize } = useFontSize();

  // What belongs to this app rather than to every Sudobility app: how pitches
  // are spelled for transposing instruments, and the developer affordances.
  const additionalSections = useMemo<SettingsSectionConfig[]>(
    () => [
      {
        id: 'score',
        icon: MusicalNoteIcon,
        label: t('settings.scoreLabel'),
        description: t('settings.scoreDescription'),
        content: (
          // Label-and-Switch inside a Card, which is how `sudojo_app` presents
          // every preference toggle: a switch reads as "on or off, applied now",
          // which is what these are — nothing here is submitted.
          <Stack direction="vertical" spacing="md">
            <Card>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div>
                  <Text weight="medium">{t('settings.pitchWritten')}</Text>
                  <Text size="sm" color="muted">
                    {t('settings.pitchDisplayHelp')}
                  </Text>
                </div>
                <Switch
                  aria-label={t('settings.pitchWritten')}
                  checked={pitchDisplay === 'written'}
                  onCheckedChange={(checked) =>
                    store.getState().setPitchDisplay(checked ? 'written' : 'concert')
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div>
                  <Text weight="medium">{t('settings.developerMode')}</Text>
                  <Text size="sm" color="muted">
                    {t('settings.developerModeHelp')}
                  </Text>
                </div>
                <Switch
                  aria-label={t('settings.developerMode')}
                  checked={developerMode}
                  onCheckedChange={(checked) => store.getState().setDeveloperMode(checked)}
                />
              </CardContent>
            </Card>
          </Stack>
        ),
      },
    ],
    [t, pitchDisplay, developerMode, store],
  );

  return (
    <Section spacing="xl">
      <GlobalSettingsPage
        theme={themeMode}
        fontSize={fontSize}
        onThemeChange={(value) => store.getState().setThemeMode(value as typeof themeMode)}
        onFontSizeChange={(value) => setFontSize(value as FontSizePref)}
        additionalSections={additionalSections}
        // Both bridges namespace the library's own keys into this app's
        // bundle. Without the `settings.page.` prefix the library asked for
        // bare `title`/`appearanceLabel`, which this bundle does not define —
        // so every string silently fell back to the English default, and the
        // page stayed English in every language.
        t={(key, fallback) => t(`settings.page.${key}`, { defaultValue: fallback ?? key })}
        appearanceT={(key, fallback) =>
          t(`settings.appearance.${key}`, { defaultValue: fallback ?? key })
        }
        showAppearanceInfoBox
        detailMaxWidth={720}
      />
    </Section>
  );
}
