// Draws color-coded LiDAR project footprints on top of the current
// background while the TopBar's dataset pulldown is open, and lets the
// user click one to activate that project — the map-side half of that
// picker, which is why it lives and dies with it rather than staying up
// for the whole LiDAR session.
//
// Fetching + relevance classification happens here and is written to
// lidarViewportAtom, which the TopBar popover also reads — one WFS call
// and one classification pass serve both the drawn shapes and the list.

import { useAtomValue, useSetAtom } from 'jotai';
import { Feature } from 'ol';
import type { FeatureLike } from 'ol/Feature';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import type OlMap from 'ol/Map';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { getArea } from 'ol/sphere';
import { Fill, Stroke, Style } from 'ol/style';
import { useEffect } from 'react';
import { mapAtom } from './atoms';
import { backgroundLayerAtom } from './layers/config/backgroundLayers/atoms';
import {
  bboxAreaEstimateM2,
  fetchLidarFootprints,
} from './layers/config/backgroundLayers/lidarFootprints';
import {
  activeLidarProjectAtom,
  activeLidarStyleAtom,
  bboxIntersects,
  fetchLidarProjects,
  resolveLidarStyle,
  sortProjectsByRelevance,
} from './layers/config/backgroundLayers/lidarProjects';
import {
  classifyRelevance,
  emptyLidarViewport,
  lidarFilterSettingsAtom,
  lidarPickerOpenAtom,
  lidarViewportAtom,
  LidarViewportEntry,
} from './layers/config/backgroundLayers/lidarRelevance';

export const LIDAR_FOOTPRINTS_LAYER_ID = 'lidarFootprintsLayer';
const PROJECT_ID_PROPERTY = '__lidarProjectId';
// How far the pointer may travel between down and up and still count as
// a pick rather than the start of a pan.
const DRAG_SLOP_PX = 4;

// Widest viewport (longer side, in metres) we'll ask the Prosjekt-
// avgrensning WFS about. Measured against the live service: a 20 km box
// returns ~1 MB of GeoJSON, a county-sized 150 km box 7.7 MB, and a
// whole-Norway box never answers at all — the upstream gives up with a
// 504 after 30 s, which is also where the /wfs-skwms1/ proxy would cut
// it. Past this width the honest answer is "zoom in", not a half-minute
// spinner ending in an empty list.
const MAX_FOOTPRINT_EXTENT_M = 50_000;

type Tier = 'primary' | 'secondary' | 'active';

const styleForTier = (tier: Tier): Style => {
  if (tier === 'active') {
    return new Style({
      stroke: new Stroke({ color: '#E0A600', width: 3 }),
      fill: new Fill({ color: 'rgba(224, 166, 0, 0.15)' }),
    });
  }
  if (tier === 'secondary') {
    return new Style({
      stroke: new Stroke({ color: '#8A8F98', width: 1, lineDash: [4, 4] }),
      fill: new Fill({ color: 'rgba(138, 143, 152, 0.05)' }),
    });
  }
  return new Style({
    stroke: new Stroke({ color: '#2F9E44', width: 2 }),
    fill: new Fill({ color: 'rgba(47, 158, 68, 0.10)' }),
  });
};

const styleFor = (feature: FeatureLike): Style =>
  styleForTier(feature.get('tier') as Tier);

const getOrCreateLayer = (map: OlMap): VectorLayer => {
  const existing = map
    .getLayers()
    .getArray()
    .find((l) => l.get('id') === LIDAR_FOOTPRINTS_LAYER_ID) as
    | VectorLayer
    | undefined;
  if (existing) return existing;
  const layer = new VectorLayer({
    source: new VectorSource(),
    zIndex: 3,
    style: styleFor,
    properties: { id: LIDAR_FOOTPRINTS_LAYER_ID },
  });
  map.addLayer(layer);
  return layer;
};

// Mount once (Layout.tsx) alongside the other map-effect hooks.
export const useLidarFootprintsLayer = () => {
  const map = useAtomValue(mapAtom);
  const backgroundLayer = useAtomValue(backgroundLayerAtom);
  const activeLidarProject = useAtomValue(activeLidarProjectAtom);
  const setActiveLidarProject = useSetAtom(activeLidarProjectAtom);
  const setActiveLidarStyle = useSetAtom(activeLidarStyleAtom);
  const setBackgroundLayer = useSetAtom(backgroundLayerAtom);
  const filters = useAtomValue(lidarFilterSettingsAtom);
  const viewport = useAtomValue(lidarViewportAtom);
  const setViewport = useSetAtom(lidarViewportAtom);
  const pickerOpen = useAtomValue(lidarPickerOpenAtom);

  const isLidarMode =
    backgroundLayer === 'lidarProject' || backgroundLayer === 'lidarHillshade';
  // The pulldown only exists in LiDAR mode, but check both — the atom
  // can be left true if the popover unmounts without closing itself.
  const picking = isLidarMode && pickerOpen;

  // Layer lifecycle: created lazily, visibility follows the pulldown.
  useEffect(() => {
    const layer = getOrCreateLayer(map);
    layer.setVisible(picking);
  }, [map, picking]);

  // Fetch + classify on viewport change while the pulldown is open.
  useEffect(() => {
    if (!picking) {
      setViewport(emptyLidarViewport('idle'));
      return;
    }
    let cancelled = false;
    // Panning fires refreshes faster than the WFS answers them; only the
    // newest one may write to the atom, or a slow early response can
    // overwrite the coverage for where the user actually ended up.
    let latestRequest = 0;

    const refresh = () => {
      const size = map.getSize();
      const center = map.getView().getCenter();
      if (!size || !center) return;
      const extent = map.getView().calculateExtent(size) as [
        number,
        number,
        number,
        number,
      ];
      const projection = map.getView().getProjection().getCode();
      const extentLonLat = transformExtent(extent, projection, 'EPSG:4326') as
        | [number, number, number, number]
        | undefined;
      if (!extentLonLat) return;

      // Claimed before the extent check too, so a fetch started while
      // zoomed in can't land afterwards and overwrite the guard state.
      const request = ++latestRequest;
      const isStale = () => cancelled || request !== latestRequest;

      if (
        Math.max(extent[2] - extent[0], extent[3] - extent[1]) >
        MAX_FOOTPRINT_EXTENT_M
      ) {
        setViewport((prev) =>
          prev.status === 'zoomedOut' ? prev : emptyLidarViewport('zoomedOut'),
        );
        return;
      }

      setViewport((prev) => ({ ...prev, status: 'loading' }));

      fetchLidarProjects()
        .then((allProjects) => {
          const candidates = allProjects
            .filter((p) => bboxIntersects(p.bboxLonLat, extentLonLat))
            .sort(sortProjectsByRelevance);
          const viewportAreaM2 = getArea(polygonFromExtent(extent), {
            projection,
          });

          return fetchLidarFootprints(extent, projection, candidates).then(
            (matches) => {
              if (isStale()) return;
              const entries: LidarViewportEntry[] = candidates.map(
                (project) => {
                  const match = matches.get(project.id);
                  const areaM2 =
                    match?.areaM2 ?? bboxAreaEstimateM2(project.bboxLonLat);
                  return {
                    project,
                    geometries: match?.geometries ?? [],
                    areaRatio:
                      viewportAreaM2 > 0 ? areaM2 / viewportAreaM2 : 0,
                  };
                },
              );
              const classified = classifyRelevance(entries, filters);
              setViewport({ status: 'ready', ...classified });
            },
          );
        })
        .catch((err) => {
          console.warn('[lidarFootprintsLayer] refresh failed', err);
          if (!isStale()) setViewport(emptyLidarViewport('error'));
        });
    };

    refresh();
    map.on('moveend', refresh);
    return () => {
      cancelled = true;
      map.un('moveend', refresh);
    };
  }, [map, picking, filters, setViewport]);

  // Render: sync features from lidarViewportAtom.
  useEffect(() => {
    const layer = getOrCreateLayer(map);
    const source = layer.getSource();
    if (!source) return;
    source.clear();
    const addEntries = (entries: LidarViewportEntry[], tier: Tier) => {
      for (const entry of entries) {
        const effectiveTier: Tier =
          activeLidarProject?.id === entry.project.id ? 'active' : tier;
        for (const geometry of entry.geometries) {
          const feature = new Feature({ geometry });
          feature.set(PROJECT_ID_PROPERTY, entry.project.id);
          feature.set('tier', effectiveTier);
          source.addFeature(feature);
        }
      }
    };
    addEntries(viewport.primary, 'primary');
    addEntries(viewport.secondary, 'secondary');
  }, [map, viewport, activeLidarProject]);

  // Click a footprint → activate that project, same as picking it from
  // the pulldown.
  //
  // Hit-tested on pointerdown rather than OL's singleclick, because that
  // same click dismisses the pulldown: React then tears this handler
  // down and clears the features a good 250 ms before singleclick would
  // fire, so a singleclick listener would never see the footprint. The
  // pointerup half is registered one-shot from inside pointerdown so it
  // still runs after that teardown.
  useEffect(() => {
    if (!picking) return;

    const layer = getOrCreateLayer(map);
    const viewportElement = map.getViewport();
    const allEntries = [...viewport.primary, ...viewport.secondary];

    const onPointerDown = (downEvent: PointerEvent) => {
      if (downEvent.button !== 0) return;
      const hitId = map.forEachFeatureAtPixel(
        map.getEventPixel(downEvent),
        (feature) => feature.get(PROJECT_ID_PROPERTY) as string | undefined,
        { hitTolerance: 3, layerFilter: (candidate) => candidate === layer },
      );
      if (!hitId) return;
      const entry = allEntries.find((e) => e.project.id === hitId);
      if (!entry) return;

      window.addEventListener(
        'pointerup',
        (upEvent: PointerEvent) => {
          // Panning the map from on top of a footprint isn't a pick.
          const moved = Math.hypot(
            upEvent.clientX - downEvent.clientX,
            upEvent.clientY - downEvent.clientY,
          );
          if (moved > DRAG_SLOP_PX) return;
          setActiveLidarProject(entry.project);
          setActiveLidarStyle((prev) =>
            resolveLidarStyle(entry.project.styles, prev),
          );
          setBackgroundLayer('lidarProject');
        },
        { once: true },
      );
    };

    viewportElement.addEventListener('pointerdown', onPointerDown);
    return () => {
      viewportElement.removeEventListener('pointerdown', onPointerDown);
    };
  }, [
    map,
    picking,
    viewport,
    setActiveLidarProject,
    setActiveLidarStyle,
    setBackgroundLayer,
  ]);
};
