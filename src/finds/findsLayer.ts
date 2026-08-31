import { useAtomValue } from 'jotai';
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

const findsStyle = new Style({
  stroke: new Stroke({ color: '#8B4513', width: 2 }),
  fill: new Fill({ color: 'rgba(139, 69, 19, 0.15)' }),
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: '#8B4513' }),
    stroke: new Stroke({ color: '#ffffff', width: 2 }),
  }),
});

const geoJson = new GeoJSON();

// Turn one PB `finds` record into OL features in the map projection.
// The stored geometry is a FeatureCollection in EPSG:4326.
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

// Replace every feature belonging to `recId` in the source with the
// hydrated features from `rec`. Used for create (recId new) + update.
const upsert = (
  source: VectorSource,
  rec: FindRecord,
  targetProjection: string,
) => {
  removeByFindId(source, rec.id);
  source.addFeatures(hydrateFeatures(rec, targetProjection));
};

const removeByFindId = (source: VectorSource, findId: string) => {
  const doomed = source
    .getFeatures()
    .filter((f) => f.get(FIND_ID_PROPERTY) === findId);
  for (const f of doomed) source.removeFeature(f);
};

// Mount from Layout. Idempotent — safe to call in strict mode.
export const useFindsLayer = () => {
  const map = useAtomValue(mapAtom);
  // Re-hydrate on sign-in/out because the visible set changes: signed-out
  // sees only 'public' finds, signed-in sees their own + public, admin
  // sees everything. The list rule enforces this server-side.
  const user = useAtomValue(currentUserAtom);

  useEffect(() => {
    // Reuse the layer across mounts (this hook is only called from
    // Layout, but React strict mode double-invokes effects; without
    // this we'd end up with two layers stacked).
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
      // Deliberately do NOT remove the layer — leaving it lets the next
      // mount reuse the same layer + zIndex without a visible flicker.
      source.clear();
    };
    // Only re-run when the identity of the signed-in principal changes.
  }, [map, user?.id]);
};

