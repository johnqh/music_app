/**
 * The account control in the top bar, in the shape `AppTopBarWithFirebaseAuth`
 * expects.
 *
 * Every other app in the family (`sudojo_app`, `shapeshyft_app`) passes
 * `AuthAction` from `@sudobility/auth-components` straight through, which is
 * why their top bars look alike. This app cannot: `AuthAction` reads its user
 * from that package's own `AuthProvider`, which takes a `firebaseConfig` and
 * talks to Firebase directly — and this app deliberately swaps Firebase for an
 * in-process shim under `VITE_E2E=1` (see `config/initialize.ts`). Mounting the
 * library provider would bypass that shim and sign the user out from under
 * every Playwright run.
 *
 * So the *shape* is shared and only the source of the user differs: this reads
 * `useAuth()` and renders the library's own `Avatar` (which takes a user as a
 * prop, so it needs no context) inside the design system's `Dropdown`. The
 * result is the same avatar-and-menu the other apps show.
 *
 * `building_blocks` injects this rather than importing it — "passed as a prop
 * to avoid hard dependency on auth-components" — which is the seam that makes
 * this substitution legitimate rather than a workaround.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthActionProps, AuthUser as LibAuthUser } from '@sudobility/auth-components';
import { Avatar } from '@sudobility/auth-components';
import { Button, Dropdown } from '@sudobility/components';
import { useAuth } from '@/app/AuthContext';

/**
 * This app's `AuthUser` carries only what it needs (`uid`, `email`,
 * `displayName`); the library's has four more fields. Filling them here keeps
 * the difference at this boundary instead of widening the app's own type to
 * satisfy a component.
 *
 * `photoURL` is null, so `Avatar` falls back to initials — which is what these
 * accounts show anyway, since sign-in is email and Google without a photo sync.
 */
function toLibUser(user: {
  uid: string;
  email: string | null;
  displayName: string | null;
}): LibAuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: null,
    isAnonymous: false,
    emailVerified: true,
    providerId: null,
  };
}

export function AuthActionAdapter({
  menuItems,
  onLoginClick,
  onLogoutClick,
  avatarSize = 32,
  dropdownAlign = 'right',
  loginButtonContent,
  className,
}: AuthActionProps) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();

  const items = useMemo(
    () => [
      ...(menuItems ?? []).map((item) => ({
        id: item.id,
        label: item.label,
        onClick: item.onClick,
        disabled: item.disabled,
        separator: item.dividerAfter,
      })),
      {
        id: 'sign-out',
        label: t('nav.signOut'),
        onClick: () => {
          onLogoutClick?.();
          void signOut();
        },
      },
    ],
    [menuItems, onLogoutClick, signOut, t],
  );

  if (!user) {
    return (
      <Button
        type="button"
        variant="primary"
        className={className}
        onClick={() => onLoginClick?.()}
      >
        {loginButtonContent ?? t('nav.signIn')}
      </Button>
    );
  }

  return (
    <Dropdown
      align={dropdownAlign}
      className={className}
      trigger={
        <Avatar
          user={toLibUser(user)}
          size={avatarSize}
          // The trigger is the button; the avatar inside it must not also be
          // clickable, or the dropdown opens and closes on the same press.
        />
      }
      items={items}
    />
  );
}
