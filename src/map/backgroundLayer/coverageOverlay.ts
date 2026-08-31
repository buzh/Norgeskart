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

// Populated when a click on the coverage overlay hits at least one polygon.
// The popup component (CoverageOverlapPopup) renders a floating card at
// `coordinate` listing every project that contains that point so the user
// can choose among overlapping datasets.
export type CoveragePickerState = {
  coordinate: [number, number];
  projects: CoverageProject[];
};
export const coveragePickerAtom = atom<CoveragePickerState | null>(null);

// Density → hue-fixed green ramp: higher pt/m² = darker + more saturated,
// so at a glance the visually heaviest polygons are the highest-quality
// captures. Alpha stays low so the underlying topo map remains readable.
// The overlay is a browse-and-pick tool, not a persistent visualization.
// Kept faint so the underlying topo remains readable while the user is
// deciding; activateCoverageProject dismisses the overlay on selection
// so the chosen dataset shows unobstructed.
const styleFor = (density: number | null, active: boolean): Style => {
  const clamped = Math.min(density ?? 0, 20);
  const lightness = 55 - clamped * 1.5; // 55% → 25%
  const fillAlpha = active ? 0.3 : 0.15;
  const fillColor =
    density == null || density === 0
      ? `hsla(0, 0%, 55%, ${fillAlpha})`
      : `hsla(150, 70%, ${lightness}%, ${fillAlpha})`;
  return new Style({
    fill: new Fill({ color: fillColor }),
    stroke: active
      ? new Stroke({ color: 'rgba(230, 120, 40, 0.95)', width: 3 })
      : new Stroke({ color: `hsla(150, 55%, 30%, 0.45)`, width: 1 }),
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
  if (!show) {
    // Dismiss any open picker popup when the overlay is turned off — the
    // popup lists project polygons that are no longer being rendered.
    getDefaultStore().set(coveragePickerAtom, null);
    return;
  }

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

// Activates a project as the WMS background source. Exposed so the popup
// component can wire its row-click handler here without duplicating the
// LidarProject-shape construction. Also dismisses the coverage overlay
// (which in turn clears the picker popup via coverageOverlayEffect) so
// the newly-selected dataset shows without polygons on top of it.
export const activateCoverageProject = (p: CoverageProject) => {
  const active: ActiveLidarProject = {
    id: p.id,
    projectName: p.projectName,
    year: p.year,
    pointDensity: p.pointDensity,
  };
  const store = getDefaultStore();
  store.set(activeLidarProjectAtom, active);
  store.set(backgroundLayerAtom, 'lidarProject');
  store.set(showCoverageOverlayAtom, false);
};

// Called from other map-click handlers (feature info, search) to decide
// whether a click landed on the coverage overlay. If it did, opens the
// picker popup listing every project containing the click point (there
// are often multiple overlapping acquisitions per area) and returns true
// so the caller can bail early — avoids stacking a coordinate-info fetch
// or a search-marker drop on top of the same click.
//
// OL fires `click` and `singleclick` as separate events with different
// listener lists, so stopPropagation from one wouldn't reach the other;
// a shared guard is simpler than getting the registration order exactly
// right across two event names.
export const handleCoverageClickIfHit = (
  map: Map,
  pixel: [number, number],
  coordinate: [number, number],
): boolean => {
  const store = getDefaultStore();
  if (!store.get(showCoverageOverlayAtom)) return false;
  const projects: CoverageProject[] = [];
  map.forEachFeatureAtPixel(
    pixel,
    (feature) => {
      const p = feature.get('coverageProject') as CoverageProject | undefined;
      if (p) projects.push(p);
      // Returning falsy keeps OL iterating so we collect every overlapping
      // polygon at this pixel, not just the topmost one.
    },
    { layerFilter: (l) => l.get('id') === OVERLAY_LAYER_ID },
  );
  if (projects.length === 0) return false;
  store.set(coveragePickerAtom, { coordinate, projects });
  return true;
};

