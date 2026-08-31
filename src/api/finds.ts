import type { FeatureCollection } from 'geojson';
import { pb } from './pocketbase';

// Visibility mirrors the enum in the `finds` collection. String values
// match the PB select options exactly — do not translate for display
// (localise via i18n keys under `finds.visibility.*` instead).
export type FindVisibility = 'private' | 'limited' | 'public';

export type FindBbox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export type FindRecord = {
  id: string;
  owner: string;
  title: string;
  description: string;
  visibility: FindVisibility;
  // GeoJSON is stored as JSON. Always a FeatureCollection so the
  // drawing tools can round-trip freely — even a single point is
  // wrapped in `{type: 'FeatureCollection', features: [...] }`.
  geometry: FeatureCollection;
  bbox: FindBbox;
  created: string;
  updated: string;
  // PB's `expand` output when we ?expand=owner.
  expand?: {
    owner?: { id: string; name: string; avatar: string };
  };
};

export type NewFindInput = {
  title: string;
  description?: string;
  visibility: FindVisibility;
  geometry: FeatureCollection;
  bbox: FindBbox;
};

const COLLECTION = 'finds';

// List everything the current auth principal is allowed to see. PB
// enforces this server-side via the collection's listRule; we don't
// need to filter here beyond ordering and pagination.
export const listFinds = async (): Promise<FindRecord[]> => {
  const page = await pb
    .collection(COLLECTION)
    .getList<FindRecord>(1, 200, {
      sort: '-updated',
      expand: 'owner',
    });
  return page.items;
};

// Convenience for the "Mine funn" panel. Even though listFinds() would
// already include the user's own records, filtering by owner keeps the
// admin's view separate (admin gets everything from listFinds, and
// their own from listMyFinds).
export const listMyFinds = async (userId: string): Promise<FindRecord[]> => {
  return pb
    .collection(COLLECTION)
    .getFullList<FindRecord>({
      filter: pb.filter('owner = {:uid}', { uid: userId }),
      sort: '-updated',
    });
};

export const createFind = async (
  input: NewFindInput,
  ownerId: string,
): Promise<FindRecord> => {
  return pb.collection(COLLECTION).create<FindRecord>({
    owner: ownerId,
    title: input.title,
    description: input.description ?? '',
    visibility: input.visibility,
    geometry: input.geometry,
    bbox: input.bbox,
  });
};

export const updateFindVisibility = async (
  id: string,
  visibility: FindVisibility,
): Promise<FindRecord> => {
  return pb.collection(COLLECTION).update<FindRecord>(id, { visibility });
};

export const deleteFind = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

// Realtime subscription — emits on create/update/delete for any record
// the user is allowed to see. Consumers (findsLayer) can invalidate
// their cache off this. Returns the unsubscribe fn.
export const subscribeFinds = (
  handler: (action: 'create' | 'update' | 'delete', rec: FindRecord) => void,
): (() => void) => {
  const p = pb
    .collection(COLLECTION)
    .subscribe<FindRecord>('*', (e) => {
      handler(e.action as 'create' | 'update' | 'delete', e.record);
    });
  return () => {
    p.then((unsub) => unsub()).catch(() => {
      /* ignore — connection may already be down */
    });
  };
};
