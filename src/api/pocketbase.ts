import PocketBase from 'pocketbase';
import { getEnv } from '../env';

// Singleton PB client. The SDK's LocalAuthStore rehydrates the session
// from localStorage on construction, so importing this module anywhere
// gets you the current auth state.
//
// If you need to react to sign-in/out, subscribe to pb.authStore.onChange
// (see src/auth/atoms.ts) rather than importing this in a component.
export const pb = new PocketBase(getEnv().pocketbaseUrl);

export type Role = 'guest' | 'user' | 'admin';

// Shape of a users record with our added `role` field. PB's default
// UsersRecord type doesn't know about the extension.
export type NkUser = {
  id: string;
  email: string;
  name: string;
  avatar: string;
  role: Role;
  created: string;
  updated: string;
};
