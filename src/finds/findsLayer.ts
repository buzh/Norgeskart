import { getDefaultStore, useAtomValue } from 'jotai';
import { Feature } from 'ol';
import { GeoJSON } from 'ol/format';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import CircleStyle from 'ol/style/Circle';
import { useEffect } from 'react';
import {
  FindRecord,
  listFinds,
  subscribeFinds,
} from '../api/finds';
import { currentUserAtom } from '../auth/atoms';
import { mapAtom } from '../map/atoms';

// Attached to every Feature we hydrate from a find, so click-handlers /
// the panel can round-trip back to the source record without a lookup.
export const FIND_ID_PROPERTY = '__findId';
export const FINDS_LAYER_ID = 'findsLayer';

// Saturated orange with a real fill so shapes stand out against the LiDAR
// hillshade (which is dark and low-contrast). Solid stroke; thick enough
// to read at low zoom, thin enough not to overwhelm a fresh sketch.
const findsStyle = new Style({
  stroke: new Stroke({ color: '#D2691E', width: 3 }),
  fill: new Fill({ color: 'rgba(210, 105, 30, 0.35)' }),
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: '#D2691E' }),
    stroke: new Stroke({ color: '#ffffff', width: 2 }),
  }),
});

const geoJson = new GeoJSON();

const hydrateFeatures = (
  rec: FindRecord,
  targetProjection: string,
): Feature[] => {
  const features = geoJson.readFeatures(rec.geometry, {
    dataProjection: 'EPSG:4326',
    featureProjection: targetProjection,
  }) as Feature[];
  for (const f of features) {
    f.set(FIND_ID_PROPERTY, rec.id);
    f.setStyle(findsStyle);
  }
  return features;
};

const removeByFindId = (source: VectorSource, findId: string) => {
  const doomed = source
    .getFeatures()
    .filter((f) => f.get(FIND_ID_PROPERTY) === findId);
  for (const f of doomed) source.removeFeature(f);
};

const upsert = (
  source: VectorSource,
  rec: FindRecord,
  targetProjection: string,
) => {
  removeByFindId(source, rec.id);
  source.addFeatures(hydrateFeatures(rec, targetProjection));
};

// Module-level access to the layer/source. Matches the pattern used by
// getDrawLayer — lets non-hook callers (NewFindPanel, MyFindsPanel) push
// changes without wiring an atom through jotai.
export const getFindsLayer = (): VectorLayer | null => {
  const map = getDefaultStore().get(mapAtom);
  const layer = map
    .getLayers()
    .getArray()
    .find((l) => l.get('id') === FINDS_LAYER_ID);
  return (layer as VectorLayer | undefined) ?? null;
};

// Push a record onto the layer immediately after createFind/updateFind —
// don't wait for the realtime subscription (SSE can lag, drop, or fail
// silently through a proxy, and we already have the record in hand).
export const upsertFindOnLayer = (rec: FindRecord) => {
  const layer = getFindsLayer();
  const source = layer?.getSource();
  if (!source) return;
  const map = getDefaultStore().get(mapAtom);
  const projection = map.getView().getProjection().getCode();
  upsert(source, rec, projection);
};

export const removeFindFromLayer = (id: string) => {
  const source = getFindsLayer()?.getSource();
  if (!source) return;
  removeByFindId(source, id);
};

// Temporarily hide a find while its owner edits it — the draft lives in
// the draw layer during that window and we don't want the persisted copy
// showing through underneath. Callers must restore on save/cancel.
export const setFindHiddenOnLayer = (id: string, hidden: boolean) => {
  const source = getFindsLayer()?.getSource();
  if (!source) return;
  for (const f of source.getFeatures()) {
    if (f.get(FIND_ID_PROPERTY) !== id) continue;
    f.setStyle(hidden ? new Style(undefined) : findsStyle);
  }
};

// Mount from Layout. Idempotent — safe to call in strict mode.
export const useFindsLayer = () => {
  const map = useAtomValue(mapAtom);
  // Re-hydrate on sign-in/out because the visible set changes: signed-out
  // sees only 'public' finds, signed-in sees their own + public, admin
  // sees everything. The list rule enforces this server-side.
  const user = useAtomValue(currentUserAtom);

  useEffect(() => {
    let layer = map
      .getLayers()
      .getArray()
      .find((l) => l.get('id') === FINDS_LAYER_ID) as VectorLayer | undefined;

    if (!layer) {
      const source = new VectorSource();
      layer = new VectorLayer({ source, zIndex: 5 });
      layer.set('id', FINDS_LAYER_ID);
      map.addLayer(layer);
    }

    const source = layer.getSource()!;
    const projection = map.getView().getProjection().getCode();
    let cancelled = false;

    source.clear();
    listFinds()
      .then((records) => {
        if (cancelled) return;
        for (const rec of records) {
          source.addFeatures(hydrateFeatures(rec, projection));
        }
      })
      .catch((e) => {
        console.warn('[findsLayer] initial load failed', e);
      });

    const unsub = subscribeFinds((action, rec) => {
      if (action === 'delete') {
        removeByFindId(source, rec.id);
      } else {
        upsert(source, rec, projection);
      }
    });

    return () => {
      cancelled = true;
      unsub();
      source.clear();
    };
  }, [map, user?.id]);
};
