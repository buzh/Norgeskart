import { atom } from 'jotai';

// Kept in its own file because AuthDialog is mounted at TopBar level
// but triggered from many places (AuthButton, and any "sign in to save"
// callout in the finds panels).
export const isAuthDialogOpenAtom = atom(false);
