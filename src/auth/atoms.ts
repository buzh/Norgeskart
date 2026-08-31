import { atom } from 'jotai';
import { atomEffect } from 'jotai-effect';
import { NkUser, pb, Role } from '../api/pocketbase';

// Source of truth: the PB SDK's authStore. This atom mirrors it so
// components can subscribe via jotai instead of onChange handlers.
// Initial value comes from LocalAuthStore (rehydrated at pb import).
export const currentUserAtom = atom<NkUser | null>(
  (pb.authStore.model as NkUser | null) ?? null,
);

// Kept in sync by pbAuthSyncEffect below. Consumers should NOT set the
// user atom directly — go through pb.collection('users').authWithOAuth2
// (or signOut) which fires authStore events that this effect catches.
export const pbAuthSyncEffect = atomEffect((_get, set) => {
  const unsubscribe = pb.authStore.onChange(() => {
    set(currentUserAtom, (pb.authStore.model as NkUser | null) ?? null);
  });
  return unsubscribe;
});

// Derived selectors so a component can subscribe only to what it needs
// without re-rendering on unrelated user field changes.
export const isSignedInAtom = atom((get) => get(currentUserAtom) != null);

export const roleAtom = atom<Role>((get) => {
  const u = get(currentUserAtom);
  if (!u) return 'guest';
  return u.role ?? 'user';
});

export const isAdminAtom = atom((get) => get(roleAtom) === 'admin');
