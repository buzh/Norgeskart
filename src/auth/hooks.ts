import { useCallback, useEffect, useState } from 'react';
import { pb } from '../api/pocketbase';

// Provider list is fetched from PB — whatever the admin enabled in the
// pb admin UI appears here (google, github, gitlab, oidc, …). We cache
// it per session so the sign-in dialog opens instantly on re-open.
export type OAuthProvider = {
  name: string;
  displayName: string;
  state: string;
  authUrl: string;
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: string;
};

let cachedProviders: OAuthProvider[] | null = null;

export const useOAuthProviders = () => {
  const [providers, setProviders] = useState<OAuthProvider[] | null>(
    cachedProviders,
  );
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (cachedProviders) return;
    let cancelled = false;
    pb.collection('users')
      .listAuthMethods()
      .then((methods) => {
        if (cancelled) return;
        cachedProviders = (methods.authProviders ??
          []) as unknown as OAuthProvider[];
        setProviders(cachedProviders);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e as Error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { providers, error };
};

// Kicks off the OAuth2 flow via the PB SDK's popup helper. On success,
// pb.authStore is updated and the currentUserAtom picks it up through
// pbAuthSyncEffect. Returns whatever the caller needs to know about
// the outcome; errors bubble.
export const useSignIn = () => {
  return useCallback(async (providerName: string) => {
    await pb.collection('users').authWithOAuth2({ provider: providerName });
  }, []);
};

export const useSignOut = () => {
  return useCallback(() => {
    pb.authStore.clear();
  }, []);
};
