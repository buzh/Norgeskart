// Shows where a LiDAR project actually lies while the TopBar's dataset
// pulldown is open: the footprint of the row the pointer is on, plus the
// dataset currently in use. Picking happens in the list, not here — this
// is the "you are pointing at *that* valley" half of it, which is why it
// lives and dies with the pulldown rather than staying up for the whole
// LiDAR session.
//
// Fetching + relevance classification happens here and is written to
// lidarViewportAtom, which the TopBar popover also reads — one WFS call
// and one classification pass serve both the drawn shapes and the list.

import { useAtomValue, useSetAtom } from 'jotai';
import { Feature } from 'ol';
import type { FeatureLike } from 'ol/Feature';
import VectorLayer from 'ol/layer/Vector';
import type OlMap from 'ol/Map';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import { useEffect } from 'react';
import { mapAtom } from './atoms';
import { backgroundLayerAtom } from './layers/config/backgroundLayers/atoms';
import {
  fetchLidarFootprints,
  touchesExtent,
  viewportCoverage,
} from './layers/config/backgroundLayers/lidarFootprints';
import {
  activeLidarProjectAtom,
  bboxIntersects,
  fetchLidarProjects,
} from './layers/config/backgroundLayers/lidarProjects';
import {
  classifyRelevance,
  emptyLidarViewport,
  hoveredLidarProjectIdAtom,
  lidarFilterSettingsAtom,
  lidarPickerOpenAtom,
  lidarViewportAtom,
  LidarViewportEntry,
  sortByOnScreenCoverage,
} from './layers/config/backgroundLayers/lidarRelevance';

export const LIDAR_FOOTPRINTS_LAYER_ID = 'lidarFootprintsLayer';

// Widest viewport (longer side, in metres) we'll ask the Prosjekt-
// avgrensning WFS about. Measured against the live service: a 20 km box
// returns ~1 MB of GeoJSON, a county-sized 150 km box 7.7 MB, and a
// whole-Norway box never answers at all — the upstream gives up with a
// 504 after 30 s, which is also where the /wfs-skwms1/ proxy would cut
// it. Past this width the honest answer is "zoom in", not a half-minute
// spinner ending in an empty list.
const MAX_FOOTPRINT_EXTENT_M = 50_000;

type Tier = 'hover' | 'active';

// At most two footprints are on screen at a time, so the styles can
// afford to be loud. Both draw a white casing under a saturated core:
// the base underneath is either green topo or grey-brown hillshade, and
// a plain coloured outline disappears into one or the other — an earlier
// green outline over green topo was effectively invisible.
const casing = (width: number) =>
  new Stroke({ color: 'rgba(255, 255, 255, 0.85)', width });

const HOVER_STYLE = [
  new Style({ stroke: casing(7), zIndex: 2 }),
  new Style({
    stroke: new Stroke({ color: '#D6336C', width: 3 }),
    fill: new Fill({ color: 'rgba(214, 51, 108, 0.12)' }),
    zIndex: 3,
  }),
];

// No fill: the active dataset is usually the one being read, and tinting
// the terrain it covers defeats the purpose.
const ACTIVE_STYLE = [
  new Style({ stroke: casing(5), zIndex: 0 }),
  new Style({
    stroke: new Stroke({ color: '#1C6FE0', width: 2, lineDash: [7, 5] }),
    zIndex: 1,
  }),
];

const styleFor = (feature: FeatureLike): Style[] =>
  feature.get('tier') === 'hover' ? HOVER_STYLE : ACTIVE_STYLE;

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
  const filters = useAtomValue(lidarFilterSettingsAtom);
  const viewport = useAtomValue(lidarViewportAtom);
  const setViewport = useSetAtom(lidarViewportAtom);
  const pickerOpen = useAtomValue(lidarPickerOpenAtom);
  const hoveredProjectId = useAtomValue(hoveredLidarProjectIdAtom);
  const setHoveredProjectId = useSetAtom(hoveredLidarProjectIdAtom);

  const isLidarMode =
    backgroundLayer === 'lidarProject' || backgroundLayer === 'lidarHillshade';
  // The pulldown only exists in LiDAR mode, but check both — the atom
  // can be left true if the popover unmounts without closing itself.
  const picking = isLidarMode && pickerOpen;

  // Layer lifecycle: created lazily, visibility follows the pulldown.
  // Hover is cleared on the way out so a row the pointer happened to be
  // over when the pulldown closed doesn't flash back on reopen.
  useEffect(() => {
    const layer = getOrCreateLayer(map);
    layer.setVisible(picking);
    if (!picking) setHoveredProjectId(null);
  }, [map, picking, setHoveredProjectId]);

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
          // Catalogue bboxes are a coarse prefilter — they cut ~1900
          // projects down to something the name join can chew through.
          // What actually qualifies a project for the list is its WFS
          // footprint touching the viewport, decided below.
          const candidates = allProjects.filter((p) =>
            bboxIntersects(p.bboxLonLat, extentLonLat),
          );

          return fetchLidarFootprints(extent, projection, candidates).then(
            (matches) => {
              if (isStale()) return;
              const entries: LidarViewportEntry[] = [];
              for (const project of candidates) {
                const geometries = matches.get(project.id)?.geometries;
                // No footprint back from the WFS, or one that only came
                // back because its envelope overlaps: the project has
                // nothing on this screen, so it isn't in this list.
                if (!geometries || !touchesExtent(geometries, extent)) continue;
                entries.push({
                  project,
                  geometries,
                  areaRatio: viewportCoverage(geometries, extent),
                });
              }
              entries.sort(sortByOnScreenCoverage);
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

  // Render: the hovered row's footprint plus the active dataset's, and
  // nothing else. Both come out of the same viewport lists the pulldown
  // renders, so a row can only light up terrain that's actually been
  // fetched and classified.
  useEffect(() => {
    const layer = getOrCreateLayer(map);
    const source = layer.getSource();
    if (!source) return;
    source.clear();

    const entries = [...viewport.primary, ...viewport.secondary];
    const byId = (id: string | null | undefined) =>
      id ? entries.find((e) => e.project.id === id) : undefined;

    const draw = (entry: LidarViewportEntry | undefined, tier: Tier) => {
      if (!entry) return;
      for (const geometry of entry.geometries) {
        const feature = new Feature({ geometry });
        feature.set('tier', tier);
        source.addFeature(feature);
      }
    };

    // Hovering the active dataset's own row should read as hover — it's
    // the row the user is asking about.
    const activeEntry = byId(activeLidarProject?.id);
    if (activeEntry && activeEntry.project.id !== hoveredProjectId) {
      draw(activeEntry, 'active');
    }
    draw(byId(hoveredProjectId), 'hover');
  }, [map, viewport, activeLidarProject, hoveredProjectId]);
};
