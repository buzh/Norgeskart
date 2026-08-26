// Runs a Draw-box interaction on the map while the LiDAR-extract tool is
// active and no selection has been made yet. On drawend, the drawn box is
// captured in map / EPSG:25833 / EPSG:4326 CRSs (see LidarExtractSelection)
// and the interaction is torn down. A dedicated VectorLayer keeps the
// resulting rectangle visible until the selection is cleared or the tool
// closes.

import { atomEffect } from 'jotai-effect';
import { getDefaultStore } from 'jotai';
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
import { mapToolAtom } from '../map/overlay/atoms';
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

const removeSelectionLayer = (map: Map) => {
  const layer = map
    .getLayers()
    .getArray()
    .find((l) => l.get('id') === SELECTION_LAYER_ID) as VectorLayer | undefined;
  if (layer) map.removeLayer(layer);
};

export const lidarExtractInteractionEffect = atomEffect((get) => {
  const tool = get(mapToolAtom);
  const selection = get(lidarExtractSelectionAtom);
  const map = get(mapAtom);

  if (tool !== 'lidarExtract') {
    // Tool closed: remove any leftover interaction + overlay layer so the
    // dashed box doesn't linger on the map.
    removeDrawInteraction(map);
    removeSelectionLayer(map);
    return;
  }

  const layer = getOrCreateSelectionLayer(map);
  const source = layer.getSource() as VectorSource;

  if (selection) {
    // Existing box: make sure the overlay reflects it (e.g. after
    // reopening the tool or after a projection change) and tear down any
    // in-flight draw.
    removeDrawInteraction(map);
    const currentProjection = map.getView().getProjection().getCode();
    const bboxCurrent =
      currentProjection === selection.mapProjection
        ? selection.bboxMap
        : (transformExtent(
            selection.bboxMap,
            selection.mapProjection,
            currentProjection,
          ) as [number, number, number, number]);
    source.clear();
    source.addFeature(new Feature({ geometry: polygonFromExtent(bboxCurrent) }));
    return;
  }

  // Start a draw interaction if one isn't already running.
  if (getDrawInteraction(map)) return;

  source.clear();

  const draw = new Draw({
    source,
    type: 'Circle', // createBox() reshapes it into an axis-aligned polygon
    geometryFunction: createBox(),
    // Freehand: press → drag → release. Without this, OL treats drags as
    // pan (click-only draws) and the user can't paint a box in one gesture.
    freehand: true,
    style: selectionStyle,
  });
  // Tag so we can distinguish this Draw from ones the draw/measure modules
  // might have added, and clean up only ours.
  draw.set('lidarExtract', true);

  draw.on('drawend', (event) => {
    const geom = event.feature.getGeometry();
    if (!(geom instanceof Polygon)) return;
    const bboxMap = geom.getExtent() as [number, number, number, number];
    const mapProjection = map.getView().getProjection().getCode();
    const bbox25833 = transformExtent(bboxMap, mapProjection, 'EPSG:25833') as
      [number, number, number, number];
    const bboxLonLat = transformExtent(bboxMap, mapProjection, 'EPSG:4326') as
      [number, number, number, number];

    getDefaultStore().set(lidarExtractSelectionAtom, {
      bboxMap,
      mapProjection,
      bbox25833,
      bboxLonLat,
    });
    // The effect will run again on the selection write, tear down this
    // draw interaction, and render the stored box.
  });

  map.addInteraction(draw);

  return () => {
    removeDrawInteraction(map);
  };
});

const getDrawInteraction = (map: Map): Draw | undefined =>
  map
    .getInteractions()
    .getArray()
    .find(
      (i) => i instanceof Draw && i.get('lidarExtract') === true,
    ) as Draw | undefined;

const removeDrawInteraction = (map: Map) => {
  const draw = getDrawInteraction(map);
  if (draw) map.removeInteraction(draw);
};
