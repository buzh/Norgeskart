import { pb } from './pocketbase';

// Visibility mirrors the enum in the `localities` collection. String
// values match the PB select options exactly — do not translate for
// display (localise via i18n keys under `localities.visibility.*`).
export type LocalityVisibility = 'private' | 'limited' | 'public';

// The authored rectangle in EPSG:4326 — created by a box drag, movable
// and resizable afterwards. Not derived from the lokalitet's content.
export type LocalityBbox = [
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
];

export type LocalityRecord = {
  id: string;
  owner: string;
  name: string;
  description: string;
  visibility: LocalityVisibility;
  bbox: LocalityBbox;
  created: string;
  updated: string;
  // PB's `expand` output when we ?expand=owner.
  expand?: {
    owner?: { id: string; name: string; avatar: string };
  };
};

export type NewLocalityInput = {
  name: string;
  description?: string;
  visibility: LocalityVisibility;
  bbox: LocalityBbox;
};

const COLLECTION = 'localities';

// Everything the current auth principal may see — PB enforces the list
// rule server-side. Full list, not a single page: localities are small
// rows (no geometry blob) and the map wants all rectangles anyway.
export const listLocalities = async (): Promise<LocalityRecord[]> => {
  return pb.collection(COLLECTION).getFullList<LocalityRecord>({
    sort: '-updated',
    expand: 'owner',
  });
};

// "Mine lokaliteter" — the admin's own records stay separate from the
// everything-view listLocalities gives them.
export const listMyLocalities = async (
  userId: string,
): Promise<LocalityRecord[]> => {
  return pb.collection(COLLECTION).getFullList<LocalityRecord>({
    filter: pb.filter('owner = {:uid}', { uid: userId }),
    sort: '-updated',
  });
};

export const getLocality = async (id: string): Promise<LocalityRecord> => {
  return pb
    .collection(COLLECTION)
    .getOne<LocalityRecord>(id, { expand: 'owner' });
};

export const createLocality = async (
  input: NewLocalityInput,
  ownerId: string,
): Promise<LocalityRecord> => {
  return pb.collection(COLLECTION).create<LocalityRecord>(
    {
      owner: ownerId,
      name: input.name,
      description: input.description ?? '',
      visibility: input.visibility,
      bbox: input.bbox,
    },
    { expand: 'owner' },
  );
};

export type LocalityPatch = Partial<{
  name: string;
  description: string;
  visibility: LocalityVisibility;
  bbox: LocalityBbox;
}>;

export const updateLocality = async (
  id: string,
  patch: LocalityPatch,
): Promise<LocalityRecord> => {
  return pb
    .collection(COLLECTION)
    .update<LocalityRecord>(id, patch, { expand: 'owner' });
};

export const deleteLocality = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

// Realtime — emits on create/update/delete for any record the user is
// allowed to see. Returns the unsubscribe fn.
export const subscribeLocalities = (
  handler: (
    action: 'create' | 'update' | 'delete',
    rec: LocalityRecord,
  ) => void,
): (() => void) => {
  const p = pb
    .collection(COLLECTION)
    .subscribe<LocalityRecord>('*', (e) => {
      handler(e.action as 'create' | 'update' | 'delete', e.record);
    });
  return () => {
    p.then((unsub) => unsub()).catch(() => {
      /* ignore — connection may already be down */
    });
  };
};
