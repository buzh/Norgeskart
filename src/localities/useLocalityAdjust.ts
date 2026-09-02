import { useAtomValue, useSetAtom } from 'jotai';
import { Feature } from 'ol';
import type { Coordinate } from 'ol/coordinate';
import { boundingExtent } from 'ol/extent';
import { Polygon } from 'ol/geom';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import VectorLayer from 'ol/layer/Vector';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import CircleStyle from 'ol/style/Circle';
import { useEffect, useRef } from 'react';
import {
  LocalityBbox,
  LocalityRecord,
  updateLocality,
} from '../api/localities';
import { mapAtom } from '../map/atoms';
import { activeLocalityAtom, adjustingLocalityAtom } from './atoms';
import {
  hideLocalityOnLayer,
  upsertLocalityOnLayer,
} from './localityLayer';

// "Juster området": while adjustingLocalityAtom is set, the open
// lokalitet's rectangle lives on a temp layer where it can be dragged
// whole (Translate) or resized by its corners (Modify). Corner drags
// deform the ring during the gesture and snap back to a rectangle on
// release: the dragged corner plus the opposite original corner define
// the new extent. Every finished gesture persists the bbox.

const ADJUST_LAYER_ID = 'localityAdjustLayer';
const CORNER_GRAB_PX = 12;

const adjustStyle = new Style({
  stroke: new Stroke({ color: '#FF6A00', width: 3 }),
  fill: new Fill({ color: 'rgba(255, 106, 0, 0.10)' }),
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: '#ffffff' }),
    stroke: new Stroke({ color: '#FF6A00', width: 2 }),
  }),
});

const ring = (polygon: Polygon): Coordinate[] =>
  polygon.getCoordinates()[0].map((c) => [...c] as Coordinate);

export const useLocalityAdjust = (locality: LocalityRecord) => {
  const map = useAtomValue(mapAtom);
  const adjusting = useAtomValue(adjustingLocalityAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);

  // Latest persisted record, for the exit-cleanup upsert (the effect
  // closure would otherwise re-render the pre-adjust rectangle).
  const latestRef = useRef<LocalityRecord>(locality);
  latestRef.current = locality;

  useEffect(() => {
    if (!adjusting) return;

    const projection = map.getView().getProjection().getCode();
    const extent = transformExtent(locality.bbox, 'EPSG:4326', projection);
    const feature = new Feature({ geometry: polygonFromExtent(extent) });
    const source = new VectorSource({ features: [feature] });
    const layer = new VectorLayer({
      source,
      zIndex: 8,
      style: adjustStyle,
      properties: { id: ADJUST_LAYER_ID },
    });
    map.addLayer(layer);
    hideLocalityOnLayer(locality.id);

    const persist = () => {
      const geom = feature.getGeometry();
      if (!(geom instanceof Polygon)) return;
      const e = geom.getExtent();
      if (e[2] - e[0] <= 0 || e[3] - e[1] <= 0) return;
      const bbox = transformExtent(e, projection, 'EPSG:4326') as LocalityBbox;
      updateLocality(locality.id, { bbox })
        .then((updated) => {
          latestRef.current = updated;
          setActiveLocality(updated);
        })
        .catch((err) =>
          console.warn('[useLocalityAdjust] bbox save failed', err),
        );
    };

    const cornerAtPixel = (pixel: number[]): boolean => {
      const geom = feature.getGeometry();
      if (!(geom instanceof Polygon)) return false;
      return ring(geom).some((c) => {
        const p = map.getPixelFromCoordinate(c);
        return (
          Math.abs(p[0] - pixel[0]) <= CORNER_GRAB_PX &&
          Math.abs(p[1] - pixel[1]) <= CORNER_GRAB_PX
        );
      });
    };

    let ringBefore: Coordinate[] | null = null;

    const modify = new Modify({
      source,
      insertVertexCondition: () => false,
    });
    modify.on('modifystart', () => {
      const geom = feature.getGeometry();
      ringBefore = geom instanceof Polygon ? ring(geom) : null;
    });
    modify.on('modifyend', () => {
      const geom = feature.getGeometry();
      if (!(geom instanceof Polygon) || !ringBefore) return;
      const ringAfter = ring(geom);
      // Which corner moved? (Ring is closed; corners are indexes 0-3.)
      let moved = -1;
      for (let i = 0; i < 4; i++) {
        const [bx, by] = ringBefore[i];
        const [ax, ay] = ringAfter[i];
        if (bx !== ax || by !== ay) {
          moved = i;
          break;
        }
      }
      if (moved >= 0) {
        const anchor = ringBefore[(moved + 2) % 4];
        const newExtent = boundingExtent([anchor, ringAfter[moved]]);
        geom.setCoordinates(polygonFromExtent(newExtent).getCoordinates());
      }
      ringBefore = null;
      persist();
    });

    const translate = new Translate({
      layers: [layer],
      // Leave corner grabs to Modify; body drags move the rectangle.
      condition: (e) => !cornerAtPixel(e.pixel as number[]),
    });
    translate.on('translateend', persist);

    map.addInteraction(translate);
    map.addInteraction(modify);

    return () => {
      map.removeInteraction(modify);
      map.removeInteraction(translate);
      map.removeLayer(layer);
      // Re-render the (possibly moved) rectangle on the shared layer.
      upsertLocalityOnLayer(latestRef.current);
    };
  }, [adjusting, map, locality.id, setActiveLocality]);
};
