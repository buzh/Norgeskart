// Manages the OL Box-Draw interaction and the selection-overlay VectorLayer
// while the LiDAR-extract panel is mounted. Runs as a plain React effect
// (not an atomEffect) so the lifecycle is unambiguously tied to the panel.

import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import Feature from 'ol/Feature';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import { Polygon } from 'ol/geom';
import Draw, { createBox } from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
import Map from 'ol/Map';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import { mapAtom } from '../map/atoms';
import { lidarExtractSelectionAtom } from './atoms';

const SELECTION_LAYER_ID = 'lidarExtractSelectionLayer';

const selectionStyle = new Style({
  stroke: new Stroke({ color: '#0e5aa0', width: 2, lineDash: [6, 4] }),
  fill: new Fill({ color: 'rgba(14, 90, 160, 0.08)' }),
});

const getOrCreateSelectionLayer = (map: Map): VectorLayer => {
  const existing = map
    .getLayers()
    .getArray()
    .find((l) => l.get('id') === SELECTION_LAYER_ID) as VectorLayer | undefined;
  if (existing) return existing;
  const layer = new VectorLayer({
    zIndex: 7,
    source: new VectorSource({ wrapX: false }),
    style: selectionStyle,
    properties: { id: SELECTION_LAYER_ID },
  });
  map.addLayer(layer);
  return layer;
};

export const useDrawSelection = () => {
  const map = useAtomValue(mapAtom);
  const selection = useAtomValue(lidarExtractSelectionAtom);
  const setSelection = useSetAtom(lidarExtractSelectionAtom);

  useEffect(() => {
    const layer = getOrCreateSelectionLayer(map);
    const source = layer.getSource() as VectorSource;

    if (selection) {
      // Existing box: render it in the current view projection.
      source.clear();
      const currentProjection = map.getView().getProjection().getCode();
      const bboxCurrent =
        currentProjection === selection.mapProjection
          ? selection.bboxMap
          : (transformExtent(
              selection.bboxMap,
              selection.mapProjection,
              currentProjection,
            ) as [number, number, number, number]);
      source.addFeature(
        new Feature({ geometry: polygonFromExtent(bboxCurrent) }),
      );
      // No draw interaction while a selection exists.
      return () => {};
    }

    source.clear();

    const draw = new Draw({
      source,
      type: 'Circle',
      geometryFunction: createBox(),
      freehand: true,
      style: selectionStyle,
    });

    draw.on('drawend', (event) => {
      const geom = event.feature.getGeometry();
      if (!(geom instanceof Polygon)) return;
      const bboxMap = geom.getExtent() as [number, number, number, number];
      const mapProjection = map.getView().getProjection().getCode();
      const bbox25833 = transformExtent(
        bboxMap,
        mapProjection,
        'EPSG:25833',
      ) as [number, number, number, number];
      const bboxLonLat = transformExtent(
        bboxMap,
        mapProjection,
        'EPSG:4326',
      ) as [number, number, number, number];
      setSelection({ bboxMap, mapProjection, bbox25833, bboxLonLat });
    });

    map.addInteraction(draw);

    return () => {
      map.removeInteraction(draw);
    };
  }, [map, selection, setSelection]);

  // Tear the whole overlay layer down when the panel unmounts.
  useEffect(() => {
    return () => {
      const layer = map
        .getLayers()
        .getArray()
        .find((l) => l.get('id') === SELECTION_LAYER_ID) as
        | VectorLayer
        | undefined;
      if (layer) map.removeLayer(layer);
    };
  }, [map]);
};
