import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import { Feature, Map } from 'ol';
import { Polygon } from 'ol/geom';
import VectorLayer from 'ol/layer/Vector';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import { currentProjectionAtom, mapAtom } from '../atoms';
import { backgroundLayerAtom } from '../layers/config/backgroundLayers/atoms';
import {
  activeLidarProjectAtom,
  fetchLidarProjects,
  LidarProject,
} from '../layers/config/backgroundLayers/lidarProjects';

const OVERLAY_LAYER_ID = 'lidarCoverageOverlay';

export const showCoverageOverlayAtom = atom<boolean>(false);

// Module-scope so subsequent effect runs (active-project changes, projection
// changes) synchronously reuse the parsed capabilities without another
// microtask hop. `fetchLidarProjects` itself also memoises via localStorage,
// but this avoids the awaited-Promise round-trip once the list is in memory.
let cachedProjects: LidarProject[] | null = null;

const parseDensity = (d: string | null): number => {
  if (!d) return 0;
  const m = d.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

// Density → hue-fixed green ramp: higher pt/m² = darker + more saturated,
// so at a glance the visually heaviest polygons are the highest-quality
// captures. Alpha stays low so the underlying topo map remains readable.
const styleFor = (density: number, active: boolean): Style => {
  const clamped = Math.min(density, 20);
  const lightness = 60 - clamped * 1.5; // 60% → 30%
  const fillAlpha = active ? 0.55 : 0.35;
  const fillColor =
    density === 0
      ? `hsla(0, 0%, 60%, ${fillAlpha})`
      : `hsla(150, 65%, ${lightness}%, ${fillAlpha})`;
  return new Style({
    fill: new Fill({ color: fillColor }),
    stroke: active
      ? new Stroke({ color: 'rgba(230, 120, 40, 0.95)', width: 3 })
      : new Stroke({ color: 'rgba(30, 90, 50, 0.7)', width: 1 }),
  });
};

const buildFeatures = (
  projects: LidarProject[],
  targetProjection: string,
  activeId: string | null,
): Feature<Polygon>[] =>
  projects.map((p) => {
    const [minX, minY, maxX, maxY] = transformExtent(
      p.bboxLonLat,
      'EPSG:4326',
      targetProjection,
    );
    const feat = new Feature(
      new Polygon([
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY],
        ],
      ]),
    );
    feat.set('lidarProject', p);
    feat.setStyle(styleFor(parseDensity(p.pointDensity), activeId === p.id));
    return feat;
  });

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

  const build = (projects: LidarProject[]) => {
    // Re-check the toggle — the fetch may have resolved after the user
    // turned the overlay off.
    if (!getDefaultStore().get(showCoverageOverlayAtom)) return;
    const layer = new VectorLayer({
      source: new VectorSource({
        features: buildFeatures(
          projects,
          targetProjection,
          activeProject?.id ?? null,
        ),
      }),
      properties: { id: OVERLAY_LAYER_ID },
      zIndex: 1,
    });
    map.addLayer(layer);
  };

  if (cachedProjects) {
    build(cachedProjects);
    return;
  }

  fetchLidarProjects()
    .then((projects) => {
      cachedProjects = projects;
      build(projects);
    })
    .catch((err) =>
      console.warn('[coverageOverlay] failed to fetch projects', err),
    );
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
    (feature) => feature.get('lidarProject') as LidarProject | undefined,
    { layerFilter: (l) => l.get('id') === OVERLAY_LAYER_ID },
  );
  if (!hit) return false;
  store.set(activeLidarProjectAtom, hit);
  store.set(backgroundLayerAtom, 'lidarProject');
  return true;
};
