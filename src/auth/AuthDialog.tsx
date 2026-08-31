import {
  Button,
  Dialog,
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  Heading,
  Stack,
  Text,
} from '@kvib/react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { isAuthDialogOpenAtom } from './atoms-dialog';
import { useOAuthProviders, useSignIn } from './hooks';

// PB provider name → localised display label. Falls back to the raw
// provider name if we haven't localised it yet — safe because PB's
// name field is stable ("google", "github", "microsoft", …).
const providerLabel = (name: string): string => {
  const map: Record<string, string> = {
    google: 'Google',
    github: 'GitHub',
    microsoft: 'Microsoft',
    gitlab: 'GitLab',
    apple: 'Apple',
    oidc: 'OIDC',
  };
  return map[name] ?? name;
};

export const AuthDialog = () => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useAtom(isAuthDialogOpenAtom);
  const { providers, error } = useOAuthProviders();
  const signIn = useSignIn();

  const handle = async (providerName: string) => {
    try {
      await signIn(providerName);
      setIsOpen(false);
    } catch (e) {
      // Popup blocked, user cancelled, or provider misconfigured. The
      // PB error message is usually informative enough — surface it
      // rather than swallowing.
      console.warn('[auth] sign-in failed', e);
    }
  };

  return (
    <Dialog
      placement="center"
      motionPreset="slide-in-left"
      onOpenChange={(e) => setIsOpen(e.open)}
      open={isOpen}
    >
      <DialogContent>
        <DialogBody>
          <Stack gap={3}>
            <Heading size="md">{t('auth.dialog.title')}</Heading>
            <Text fontSize="sm" color="gray.600">
              {t('auth.dialog.subtitle')}
            </Text>
            {error && (
              <Text fontSize="sm" color="red.600">
                {t('auth.dialog.providersError')}
              </Text>
            )}
            {providers == null && !error && (
              <Text fontSize="sm" color="gray.500">
                {t('auth.dialog.loading')}
              </Text>
            )}
            {providers && providers.length === 0 && (
              <Text fontSize="sm" color="gray.600">
                {t('auth.dialog.noProviders')}
              </Text>
            )}
            {providers &&
              providers.map((p) => (
                <Button
                  key={p.name}
                  variant="secondary"
                  colorPalette="green"
                  onClick={() => handle(p.name)}
                >
                  {t('auth.dialog.signInWith', {
                    provider: providerLabel(p.name),
                  })}
                </Button>
              ))}
          </Stack>
        </DialogBody>
        <DialogCloseTrigger />
      </DialogContent>
    </Dialog>
  );
};
