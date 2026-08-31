import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import { Feature, Map } from 'ol';
import { Geometry } from 'ol/geom';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import { currentProjectionAtom, mapAtom } from '../atoms';
import { backgroundLayerAtom } from '../layers/config/backgroundLayers/atoms';
import {
  ActiveLidarProject,
  activeLidarProjectAtom,
} from '../layers/config/backgroundLayers/lidarProjects';
import { CoverageProject, fetchCoverageInBbox } from './wfsCoverage';

const OVERLAY_LAYER_ID = 'lidarCoverageOverlay';
const WFS_SRS = 'EPSG:25833';

export const showCoverageOverlayAtom = atom<boolean>(false);

// Density → hue-fixed green ramp: higher pt/m² = darker + more saturated,
// so at a glance the visually heaviest polygons are the highest-quality
// captures. Alpha stays low so the underlying topo map remains readable.
const styleFor = (density: number | null, active: boolean): Style => {
  const clamped = Math.min(density ?? 0, 20);
  const lightness = 55 - clamped * 1.5; // 55% → 25%
  const fillAlpha = active ? 0.6 : 0.45;
  const fillColor =
    density == null || density === 0
      ? `hsla(0, 0%, 55%, ${fillAlpha})`
      : `hsla(150, 70%, ${lightness}%, ${fillAlpha})`;
  return new Style({
    fill: new Fill({ color: fillColor }),
    // Match the fill hue so the outline reads as part of the polygon
    // rather than an unrelated black artifact on the map.
    stroke: active
      ? new Stroke({ color: 'rgba(230, 120, 40, 0.95)', width: 3 })
      : new Stroke({ color: `hsla(150, 55%, 25%, 0.55)`, width: 1 }),
  });
};

// Reprojects a WFS-native (EPSG:25833) feature into the map's current
// projection, tags it for click hit-testing, and applies the density style.
const buildRenderFeature = (
  p: CoverageProject,
  targetProjection: string,
  activeId: string | null,
): Feature<Geometry> => {
  const clone = p.feature.clone();
  if (targetProjection !== WFS_SRS) {
    clone.getGeometry()?.transform(WFS_SRS, targetProjection);
  }
  clone.set('coverageProject', p);
  clone.setStyle(styleFor(p.pointDensity, activeId === p.id));
  return clone;
};

const populateSource = (
  source: VectorSource,
  projects: Iterable<CoverageProject>,
  targetProjection: string,
  activeId: string | null,
) => {
  source.clear();
  const feats: Feature<Geometry>[] = [];
  for (const p of projects) {
    feats.push(buildRenderFeature(p, targetProjection, activeId));
  }
  source.addFeatures(feats);
};

const removeExistingOverlay = (map: Map) => {
  map
    .getLayers()
    .getArray()
    .filter((l) => l.get('id') === OVERLAY_LAYER_ID)
    .forEach((l) => map.removeLayer(l));
};

export const coverageOverlayEffect = atomEffect((get) => {
  const show = get(showCoverageOverlayAtom);
  const map = get(mapAtom);
  const activeProject = get(activeLidarProjectAtom);
  const targetProjection = get(currentProjectionAtom);

  removeExistingOverlay(map);
  if (!show) return;

  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    properties: { id: OVERLAY_LAYER_ID },
    zIndex: 1,
  });
  map.addLayer(layer);

  const refresh = () => {
    const size = map.getSize();
    if (!size) return;
    const extent = map.getView().calculateExtent(size);
    if (!extent) return;
    fetchCoverageInBbox(
      [extent[0], extent[1], extent[2], extent[3]],
      targetProjection,
    )
      .then((cache) => {
        // Re-check the toggle — the fetch may have resolved after the
        // user turned the overlay off (or a projection change tore this
        // effect down).
        if (!getDefaultStore().get(showCoverageOverlayAtom)) return;
        populateSource(
          source,
          cache.values(),
          targetProjection,
          activeProject?.id ?? null,
        );
      })
      .catch((err) =>
        console.warn('[coverageOverlay] WFS fetch failed', err),
      );
  };

  refresh();
  const onMoveEnd = () => refresh();
  map.on('moveend', onMoveEnd);

  return () => {
    map.un('moveend', onMoveEnd);
    map.removeLayer(layer);
  };
});

// Called from other map-click handlers (feature info, search) to decide
// whether a click landed on a coverage polygon. If it did, activates that
// project as the background source and returns true so the caller can bail
// early — this avoids stacking a coordinate-info fetch or a search-marker
// drop on top of the source switch.
//
// OL fires `click` and `singleclick` as separate events with different
// listener lists, so stopPropagation from one wouldn't reach the other;
// a shared guard is simpler than getting the registration order exactly
// right across two event names.
export const handleCoverageClickIfHit = (
  map: Map,
  pixel: [number, number],
): boolean => {
  const store = getDefaultStore();
  if (!store.get(showCoverageOverlayAtom)) return false;
  const hit = map.forEachFeatureAtPixel(
    pixel,
    (feature) => feature.get('coverageProject') as CoverageProject | undefined,
    { layerFilter: (l) => l.get('id') === OVERLAY_LAYER_ID },
  );
  if (!hit) return false;
  const active: ActiveLidarProject = {
    id: hit.id,
    projectName: hit.projectName,
    year: hit.year,
    pointDensity: hit.pointDensity,
  };
  store.set(activeLidarProjectAtom, active);
  store.set(backgroundLayerAtom, 'lidarProject');
  return true;
};

