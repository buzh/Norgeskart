import { getDefaultStore, useAtomValue, useSetAtom } from 'jotai';
import { Feature, MapBrowserEvent } from 'ol';
import BaseEvent from 'ol/events/Event';
import type { FeatureLike } from 'ol/Feature';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style, Text } from 'ol/style';
import { useEffect } from 'react';
import {
  getLocality,
  listLocalities,
  LocalityBbox,
  LocalityRecord,
  subscribeLocalities,
} from '../api/localities';
import { currentUserAtom } from '../auth/atoms';
import { mapAtom } from '../map/atoms';
import { activeLocalityAtom, creatingLocalityAtom } from './atoms';

export const LOCALITY_ID_PROPERTY = '__localityId';
export const LOCALITIES_LAYER_ID = 'localitiesLayer';

// The open lokalitet gets a heavier frame. Module-level because the
// style function can't reach jotai hooks; the workspace keeps it synced.
let highlightedLocalityId: string | null = null;

const baseStyle = (name: string, highlighted: boolean) =>
  new Style({
    stroke: new Stroke({
      color: '#FF6A00',
      width: highlighted ? 4 : 2,
      lineDash: highlighted ? undefined : [8, 6],
    }),
    fill: new Fill({
      color: highlighted ? 'rgba(255, 106, 0, 0.04)' : 'rgba(255, 106, 0, 0.08)',
    }),
    text: new Text({
      text: name,
      font: '600 13px sans-serif',
      fill: new Fill({ color: '#7a3300' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
      overflow: true,
    }),
  });

const styleFor = (feature: FeatureLike): Style =>
  baseStyle(
    (feature.get('name') as string) ?? '',
    feature.get(LOCALITY_ID_PROPERTY) === highlightedLocalityId,
  );

// PB json fields arrive parsed in REST responses but have shipped as
// strings over realtime SSE — cope with both.
const asBbox = (raw: unknown): LocalityBbox | null => {
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === 'number')
  ) {
    return value as LocalityBbox;
  }
  return null;
};

const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const hydrateFeature = (
  rec: LocalityRecord,
  targetProjection: string,
): Feature | null => {
  const bbox = asBbox(rec.bbox);
  if (!bbox) {
    console.warn(`[localityLayer] "${rec.id}" has no readable bbox`, rec.bbox);
    return null;
  }
  const extent = transformExtent(bbox, 'EPSG:4326', targetProjection);
  const feature = new Feature({ geometry: polygonFromExtent(extent) });
  feature.set(LOCALITY_ID_PROPERTY, rec.id);
  feature.set('name', rec.name);
  return feature;
};

export const getLocalitiesLayer = (): VectorLayer | null => {
  const map = getDefaultStore().get(mapAtom);
  const layer = map
    .getLayers()
    .getArray()
    .find((l) => l.get('id') === LOCALITIES_LAYER_ID);
  return (layer as VectorLayer | undefined) ?? null;
};

const removeById = (source: VectorSource, id: string) => {
  const doomed = source
    .getFeatures()
    .filter((f) => f.get(LOCALITY_ID_PROPERTY) === id);
  for (const f of doomed) source.removeFeature(f);
};

// Push a record straight onto the layer after create/update — realtime
// is best-effort and we already hold the record.
export const upsertLocalityOnLayer = (rec: LocalityRecord) => {
  const layer = getLocalitiesLayer();
  const source = layer?.getSource();
  if (!source) return;
  const map = getDefaultStore().get(mapAtom);
  const projection = map.getView().getProjection().getCode();
  removeById(source, rec.id);
  const feature = hydrateFeature(rec, projection);
  if (feature) source.addFeature(feature);
};

export const removeLocalityFromLayer = (id: string) => {
  const source = getLocalitiesLayer()?.getSource();
  if (source) removeById(source, id);
};

export const setLocalityHighlight = (id: string | null) => {
  highlightedLocalityId = id;
  getLocalitiesLayer()?.changed();
};

// Mount from Layout. Everything is behind sign-in: signed out, the layer
// stays empty and we never hit PB.
export const useLocalitiesLayer = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);

  useEffect(() => {
    let layer = map
      .getLayers()
      .getArray()
      .find((l) => l.get('id') === LOCALITIES_LAYER_ID) as
      | VectorLayer
      | undefined;

    if (!layer) {
      layer = new VectorLayer({
        source: new VectorSource(),
        zIndex: 4,
        style: styleFor,
        properties: { id: LOCALITIES_LAYER_ID },
      });
      map.addLayer(layer);
    }

    const source = layer.getSource()!;
    source.clear();
    if (!user) return;

    const projection = map.getView().getProjection().getCode();
    let cancelled = false;

    listLocalities()
      .then((records) => {
        if (cancelled) return;
        for (const rec of records) {
          const feature = hydrateFeature(rec, projection);
          if (feature) source.addFeature(feature);
        }
      })
      .catch((e) => {
        console.warn('[localityLayer] initial load failed', e);
      });

    const unsub = subscribeLocalities((action, rec) => {
      if (action === 'delete') {
        removeById(source, rec.id);
      } else {
        removeById(source, rec.id);
        const feature = hydrateFeature(rec, projection);
        if (feature) source.addFeature(feature);
      }
    });

    return () => {
      cancelled = true;
      unsub();
      source.clear();
    };
  }, [map, user?.id]);
};

// Click a rectangle (outside any workspace/tool) → open its workspace.
export const useLocalityClick = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const active = useAtomValue(activeLocalityAtom);
  const creating = useAtomValue(creatingLocalityAtom);
  const setActive = useSetAtom(activeLocalityAtom);

  useEffect(() => {
    if (!user || creating) return;

    const onClick = (e: Event | BaseEvent) => {
      if (!(e instanceof MapBrowserEvent)) return;
      let hitId: string | null = null;
      map.forEachFeatureAtPixel(
        e.pixel as [number, number],
        (feature, layer) => {
          if (layer?.get('id') !== LOCALITIES_LAYER_ID) return undefined;
          const id = feature.get(LOCALITY_ID_PROPERTY) as string | undefined;
          if (id) {
            hitId = id;
            return true;
          }
          return undefined;
        },
        { hitTolerance: 3 },
      );
      // Re-clicking the open lokalitet is a no-op; clicking another swaps.
      if (!hitId || hitId === active?.id) return;
      getLocality(hitId)
        .then((rec) => setActive(rec))
        .catch((err) =>
          console.warn('[localityLayer] open-on-click failed', err),
        );
    };

    map.on('singleclick', onClick);
    return () => {
      map.un('singleclick', onClick);
    };
  }, [map, user, creating, active?.id, setActive]);
};
