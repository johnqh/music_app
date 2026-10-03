/**
 * The signed-out state of a page that needs an account: what is missing, and
 * the way in — the sign-in modal opened over the page, not a trip to the
 * sign-in route. Signing in closes the modal and the page that asked
 * re-renders with what it is for. music_app_rn's `SignInRequired`.
 */
import { useTranslation } from 'react-i18next';
import { Button, Text } from '@sudobility/components';
import { useSignIn } from './SignInModal';

export function SignInRequired() {
  const { t } = useTranslation();
  const { openSignIn } = useSignIn();
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <Text as="p" color="muted" align="center">
        {t('library.authRequired')}
      </Text>
      <Button type="button" variant="primary" onClick={() => openSignIn()}>
        {t('nav.signIn')}
      </Button>
    </div>
  );
}
