import { atom } from 'jotai';

// Set to a find id while the user is editing it via NewFindPanel. When
// non-null, the panel operates in edit mode (seed form, hydrate features
// into the draw layer, call updateFind on save). Cleared on save/cancel.
export const editingFindIdAtom = atom<string | null>(null);
