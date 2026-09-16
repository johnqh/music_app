/**
 * The top bar, as configuration.
 *
 * `AppPageLayout` renders whatever this returns, so the shell is data rather
 * than JSX — the arrangement `sudojo_app` uses, and the reason its
 * `ScreenContainer` stays short enough to read in one screen. This sits beside
 * `useFooterConfig`, which already worked this way.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AuthActionProps, AuthMenuItem, TopBarConfig } from '@sudobility/building_blocks';
import type { ComponentType } from 'react';
import { AuthActionAdapter } from '@/components/layout/AuthActionAdapter';
import { LinkWrapper } from '@/components/layout/LinkWrapper';
import { CONSTANTS } from '@/config/constants';
import { LANGUAGE_OPTIONS } from '@/config/languages';
import { useCurrentLanguage, useSwitchLanguage } from '@/hooks/useLocalizedNavigate';
import type { LanguagePrefStore } from '@/hooks/useLocalizedNavigate';
import { isLanguageSupported } from '@/i18n';

/** `store` receives the language pref when the bar's selector switches language. */
export function useTopBarConfig(store?: LanguagePrefStore): TopBarConfig {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const lang = useCurrentLanguage();
  const switchLanguage = useSwitchLanguage(store);

  // The account menu holds what belongs to the *user*: their credit balance,
  // what they bought, and the account itself. UI settings are not here — they
  // are a top-level nav item, as they are in `sudojo_app`, because they belong
  // to the app rather than to whoever is signed in.
  const authenticatedMenuItems = useMemo<AuthMenuItem[]>(
    () => [
      {
        id: 'credits',
        label: t('nav.credits'),
        onClick: () => navigate(`/${lang}/credits`),
      },
      {
        id: 'purchases',
        label: t('nav.purchases'),
        onClick: () => navigate(`/${lang}/credits/history`),
        dividerAfter: true,
      },
    ],
    [t, navigate, lang],
  );

  return useMemo<TopBarConfig>(
    () => ({
      // `firebase`, matching every other app in the family: it renders
      // `AppTopBarWithFirebaseAuth`, which is what gives the avatar-and-menu
      // account control. `base` has no auth affordance at all.
      variant: 'firebase',
      topBarVariant: 'app',
      logo: {
        src: '/logo-96.png',
        alt: CONSTANTS.APP_NAME,
        appName: CONSTANTS.APP_NAME,
        onClick: () => navigate(`/${lang}`),
      },
      // Settings is app-level UI configuration (theme, text size, developer
      // options), so it sits in the nav beside Projects rather than under the
      // account — the same place `sudojo_app` puts it.
      menuItems: [
        { id: 'projects', label: t('nav.projects'), href: `/${lang}/projects` },
        { id: 'community', label: t('nav.community'), href: `/${lang}/community` },
        { id: 'docs', label: t('nav.docs'), href: `/${lang}/docs` },
        { id: 'resources', label: t('nav.resources'), href: `/${lang}/resources` },
        { id: 'settings', label: t('nav.settings'), href: `/${lang}/settings` },
      ],
      // The top bar has a language selector built in. Its own default list is
      // 16 languages, so it must be given this app's — offering a language with
      // no bundle behind it leaves every string rendering as its raw key.
      languages: LANGUAGE_OPTIONS,
      currentLanguage: lang,
      onLanguageChange: (code: string) => {
        if (isLanguageSupported(code)) switchLanguage(code);
      },
      // React Router navigates by `to`; the library passes `href`. Without this
      // adapter every menu item resolves to the page already open.
      LinkComponent: LinkWrapper,
      AuthActionComponent: AuthActionAdapter as ComponentType<AuthActionProps>,
      authenticatedMenuItems,
      onLoginClick: () => navigate(`/${lang}/signin`),
      sticky: true,
      ariaLabel: t('nav.mainNavigation'),
    }),
    [t, navigate, lang, switchLanguage, authenticatedMenuItems],
  );
}
