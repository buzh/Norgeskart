import type { FeatureCollection } from 'geojson';
import { pb } from './pocketbase';

// Child level of a lokalitet: one record per funn the user marks inside
// the rectangle. Visibility is inherited from the parent lokalitet via
// relation traversal in the collection rules — no visibility field here.
//
// Status values match the PB select options exactly; they double as the
// lifecycle of a candidate: mulig → sannsynlig → avkreftet → rapportert.
export type LocalityFindStatus =
  | 'mulig'
  | 'sannsynlig'
  | 'avkreftet'
  | 'rapportert';

export type LocalityFindRecord = {
  id: string;
  locality: string;
  owner: string;
  title: string;
  note: string;
  status: LocalityFindStatus;
  // GeoJSON in EPSG:4326, always a FeatureCollection so the draw tools
  // round-trip verbatim — usually one shape, but a funn may be several
  // strokes (e.g. outline + text label).
  geometry: FeatureCollection;
  created: string;
  updated: string;
};

export type NewLocalityFindInput = {
  locality: string;
  title: string;
  note?: string;
  status?: LocalityFindStatus;
  geometry: FeatureCollection;
};

const COLLECTION = 'finds';

export const listLocalityFinds = async (
  localityId: string,
): Promise<LocalityFindRecord[]> => {
  return pb.collection(COLLECTION).getFullList<LocalityFindRecord>({
    filter: pb.filter('locality = {:lid}', { lid: localityId }),
    sort: 'created',
  });
};

export const createLocalityFind = async (
  input: NewLocalityFindInput,
  ownerId: string,
): Promise<LocalityFindRecord> => {
  return pb.collection(COLLECTION).create<LocalityFindRecord>({
    locality: input.locality,
    owner: ownerId,
    title: input.title,
    note: input.note ?? '',
    status: input.status ?? 'mulig',
    geometry: input.geometry,
  });
};

export type LocalityFindPatch = Partial<{
  title: string;
  note: string;
  status: LocalityFindStatus;
  geometry: FeatureCollection;
}>;

export const updateLocalityFind = async (
  id: string,
  patch: LocalityFindPatch,
): Promise<LocalityFindRecord> => {
  return pb.collection(COLLECTION).update<LocalityFindRecord>(id, patch);
};

export const deleteLocalityFind = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

// Realtime over the whole collection — PB wildcard subscriptions can't
// filter server-side on our SDK version, so consumers check
// `rec.locality` against the open lokalitet themselves.
export const subscribeLocalityFinds = (
  handler: (
    action: 'create' | 'update' | 'delete',
    rec: LocalityFindRecord,
  ) => void,
): (() => void) => {
  const p = pb
    .collection(COLLECTION)
    .subscribe<LocalityFindRecord>('*', (e) => {
      handler(e.action as 'create' | 'update' | 'delete', e.record);
    });
  return () => {
    p.then((unsub) => unsub()).catch(() => {
      /* ignore — connection may already be down */
    });
  };
};
