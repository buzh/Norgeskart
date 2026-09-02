import { atom } from 'jotai';
import { LocalityRecord } from '../api/localities';

// The open lokalitet — non-null means the workspace panel is showing and
// the funn layer is hydrated for this record. Holds a snapshot; the
// workspace refreshes it after its own updates.
export const activeLocalityAtom = atom<LocalityRecord | null>(null);

// "Ny lokalitet" armed: the box-drag interaction is live and the next
// drag creates a record (see useLocalityCreate). Cancelled by Escape or
// clicking the TopBar button again.
export const creatingLocalityAtom = atom<boolean>(false);

// A funn is being drawn/edited in the workspace right now. Layout uses
// this to mount the mobile bottom draw toolbar (the standalone 'draw'
// MapTool no longer exists).
export const funnDraftActiveAtom = atom<boolean>(false);
