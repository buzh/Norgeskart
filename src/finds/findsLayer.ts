import { getDefaultStore, useAtomValue } from 'jotai';
import { Feature } from 'ol';
import { GeoJSON } from 'ol/format';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import CircleStyle from 'ol/style/Circle';
import type { FeatureCollection } from 'geojson';
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

// Bright, high-contrast style. LiDAR hillshade is dark grey and existing
// draw defaults are blue — this orange reads clearly against either.
const findsStyle = new Style({
  stroke: new Stroke({ color: '#FF6A00', width: 3 }),
  fill: new Fill({ color: 'rgba(255, 106, 0, 0.35)' }),
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: '#FF6A00' }),
    stroke: new Stroke({ color: '#ffffff', width: 2 }),
  }),
});

const geoJson = new GeoJSON();

// PB's JS SDK returns `json` fields as parsed objects in most versions,
// but realtime SSE payloads have shipped as strings in some builds. Cope
// with both so a proxy quirk can't leave us with silently-empty features.
const asFeatureCollection = (raw: unknown): FeatureCollection | null => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as FeatureCollection;
    } catch (e) {
      console.warn('[findsLayer] geometry string not parseable', e);
      return null;
    }
  }
  return raw as FeatureCollection;
};

const hydrateFeatures = (
  rec: FindRecord,
  targetProjection: string,
): Feature[] => {
  const fc = asFeatureCollection(rec.geometry);
  if (!fc || !Array.isArray(fc.features)) {
    console.warn(
      `[findsLayer] find "${rec.id}" has no readable FeatureCollection`,
      rec.geometry,
    );
    return [];
  }
  let features: Feature[];
  try {
    features = geoJson.readFeatures(fc, {
      dataProjection: 'EPSG:4326',
      featureProjection: targetProjection,
    }) as Feature[];
  } catch (e) {
    console.warn(`[findsLayer] readFeatures threw for "${rec.id}"`, e);
    return [];
  }
  for (const f of features) {
    f.set(FIND_ID_PROPERTY, rec.id);
    f.setStyle(findsStyle);
  }
  console.info(
    `[findsLayer] hydrated ${features.length} feature(s) for "${rec.title}" (${rec.id})`,
  );
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
  const features = hydrateFeatures(rec, targetProjection);
  if (features.length > 0) source.addFeatures(features);
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
  if (!source) {
    console.warn('[findsLayer] upsert: no layer found on map');
    return;
  }
  const map = getDefaultStore().get(mapAtom);
  const projection = map.getView().getProjection().getCode();
  upsert(source, rec, projection);
  console.info(
    `[findsLayer] upsert done, source now has ${source.getFeatures().length} feature(s)`,
  );
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
      layer = new VectorLayer({
        source,
        zIndex: 5,
        properties: { id: FINDS_LAYER_ID },
      });
      map.addLayer(layer);
      console.info('[findsLayer] created layer, zIndex=5');
    }

    const source = layer.getSource()!;
    const projection = map.getView().getProjection().getCode();
    let cancelled = false;

    source.clear();
    console.info(
      `[findsLayer] loading, user=${user?.id ?? 'guest'} projection=${projection}`,
    );
    listFinds()
      .then((records) => {
        if (cancelled) return;
        console.info(`[findsLayer] listFinds returned ${records.length} record(s)`);
        for (const rec of records) {
          const features = hydrateFeatures(rec, projection);
          if (features.length > 0) source.addFeatures(features);
        }
        console.info(
          `[findsLayer] initial load done, source has ${source.getFeatures().length} feature(s)`,
        );
      })
      .catch((e) => {
        console.warn('[findsLayer] initial load failed', e);
      });

    const unsub = subscribeFinds((action, rec) => {
      console.info(`[findsLayer] realtime ${action} ${rec.id}`);
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
