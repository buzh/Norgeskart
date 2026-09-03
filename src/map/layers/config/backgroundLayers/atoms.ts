import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import TileLayer from 'ol/layer/Tile';
import {
  getUrlParameter,
  setUrlParameter,
} from '../../../../shared/utils/urlUtils';
import { mapAtom } from '../../../atoms';
import { BackgroundLayerName, WMTSLayerName } from '../../backgroundLayers';
import { buildNationalLidarConfig } from './elevation';
import { KvCacheBackgroundLayers } from './kvCache';
import {
  activeLidarProjectAtom,
  activeLidarStyleAtom,
  DEFAULT_LIDAR_PROJECT_STYLE,
  LIDAR_PROJECT_WMS_URL,
} from './lidarProjects';
import { retryBlankTileLoadFunction } from './loadFunctions';
import {
  BackgroundLayer,
  EmptyBackgroundLayer,
  WMSBackgroundLayer,
} from './types';
import {
  buildOrReuseBackgroundLayer,
  clearBackgroundLayer,
  swapBackgroundLayers,
} from './utils';

// Kartverket's LiDAR WMS layers return transparent PNGs outside their
// coverage areas (both wms.hoyde-dtm-nhm-topobathy-25833 and per-project
// wms.hoyde-dtm-prosjekt behave this way). Rendering them on top of the
// topo WMTS layer means the topo shines through the transparent tiles,
// so the user still has geographic context outside the LiDAR footprint
// instead of an empty grey canvas.
const NEEDS_TOPO_BASE = new Set<BackgroundLayerName>([
  'lidarProject',
  'lidarHillshade',
]);

// How far the national mosaic is dimmed when it's playing backdrop to a
// per-project dataset: strong enough to read relief outside the
// project's footprint, weak enough that the project is obviously the
// layer in focus. The topo base still sits under it, so the uncovered
// area also picks up a green cast — which turns out to be useful, the
// coverage edge reads as a change in hue as well as in contrast. Turn
// this up towards 1 if the blend is too soft to read terrain in.
const LIDAR_FALLBACK_OPACITY = 0.6;

const emptyBackgroundLayer: EmptyBackgroundLayer = {
  type: 'Empty',
  layerName: 'empty',
};

// 'lidarHillshade' (national mosaic) and 'lidarProject' are both handled
// as dynamic branches in backgroundLayerAtomEffect below — their style
// comes from activeLidarStyleAtom, so neither has a static entry here.
export const allConfiguredBackgroundLayers = [
  emptyBackgroundLayer,
  ...KvCacheBackgroundLayers,
];

// Startup values the URL param may name directly. `lidarProject` is
// excluded because its concrete acquisition lives in
// `activeLidarProjectAtom`, which starts null on a fresh visit — leaving
// the app on `lidarProject` with no active project renders nothing.
const VALID_STARTUP_LAYERS = new Set<BackgroundLayerName>([
  'topo',
  'lidarHillshade',
  'empty',
]);

const getDefaultBackgroundLayer = (): BackgroundLayerName => {
  const layerNameFromUrl = getUrlParameter(
    'backgroundLayer',
  ) as BackgroundLayerName | null;
  if (layerNameFromUrl && VALID_STARTUP_LAYERS.has(layerNameFromUrl)) {
    return layerNameFromUrl;
  }
  return 'topo';
};

export const backgroundLayerCapabilitiesCacheAtom = atom<
  Partial<Record<WMTSLayerName, string>>
>({});

export const backgroundLayerAtom = atom<BackgroundLayerName>(
  getDefaultBackgroundLayer(),
);

const buildLidarProjectConfig = (
  projectId: string,
  style: string,
): WMSBackgroundLayer => ({
  type: 'WMS',
  layerName: 'lidarProject',
  url: LIDAR_PROJECT_WMS_URL,
  props: {
    LAYERS: `${projectId}:${style}`,
    VERSION: '1.3.0',
  },
  tileLoadFunction: retryBlankTileLoadFunction,
});

export const backgroundLayerAtomEffect = atomEffect((get) => {
  const layerName = get(backgroundLayerAtom);
  // Depend on the active lidar project + style so switching either while
  // a LiDAR layer is the background rebuilds the WMS layer.
  const activeLidarProject = get(activeLidarProjectAtom);
  const activeLidarStyle = get(activeLidarStyleAtom);

  if (layerName === 'empty') {
    clearBackgroundLayer();
    setUrlParameter('backgroundLayer', 'empty');
    return;
  }

  const layerConfig: BackgroundLayer | undefined =
    layerName === 'lidarProject'
      ? activeLidarProject
        ? buildLidarProjectConfig(activeLidarProject.id, activeLidarStyle)
        : undefined
      : layerName === 'lidarHillshade'
        ? buildNationalLidarConfig(activeLidarStyle)
        : allConfiguredBackgroundLayers.find((l) => l.layerName === layerName);

  if (!layerConfig) {
    if (layerName === 'lidarProject') {
      // No project selected yet — nothing to render, no warning needed.
      return;
    }
    console.warn(`No layer config found for layer name: ${layerName}`);
    return;
  }

  const effect = async () => {
    try {
      const store = getDefaultStore();
      const map = store.get(mapAtom);
      const projection = map.getView().getProjection().getCode();

      // Everything the requested layer sits on top of, built in parallel
      // with it — cheaper than sequentially, and it keeps the swap atomic
      // (the whole stack is ready before swapBackgroundLayers runs).
      const baseTopoConfig = NEEDS_TOPO_BASE.has(layerName)
        ? allConfiguredBackgroundLayers.find((l) => l.layerName === 'topo')
        : undefined;

      // A per-project dataset typically covers a fraction of the screen.
      // Dropping to topo outside its footprint reads as "the terrain
      // stopped", and while cycling projects it's the loudest thing on
      // screen. The national mosaic underneath instead keeps relief
      // everywhere, and faded it stays clearly subordinate to the
      // project — the coverage edge is the contrast step, not a switch
      // to a different kind of map. Fixed to the mosaic's own style:
      // it publishes skyggerelieff and nothing else.
      const lidarFallbackConfig =
        layerName === 'lidarProject'
          ? buildNationalLidarConfig(DEFAULT_LIDAR_PROJECT_STYLE)
          : undefined;

      const [baseLayer, lidarFallback, topLayer] = await Promise.all([
        baseTopoConfig
          ? buildOrReuseBackgroundLayer(baseTopoConfig, projection)
          : Promise.resolve(null),
        lidarFallbackConfig
          ? buildOrReuseBackgroundLayer(lidarFallbackConfig, projection)
          : Promise.resolve(null),
        buildOrReuseBackgroundLayer(layerConfig, projection),
      ]);

      if (!topLayer) return;

      // Always set opacity explicitly: any of these may be a reused
      // layer still carrying the fade from an earlier swap.
      baseLayer?.setOpacity(1);
      lidarFallback?.setOpacity(LIDAR_FALLBACK_OPACITY);
      topLayer.setOpacity(1);

      swapBackgroundLayers(
        [baseLayer, lidarFallback, topLayer].filter(
          (l): l is TileLayer => l != null,
        ),
      );
      setUrlParameter('backgroundLayer', layerName);

      if (layerConfig.moveToExtent) {
        map.getView().fit(layerConfig.moveToExtent, { duration: 200 });
      }
    } catch (error) {
      console.error(
        `Error fetching capabilities for layer ${layerName}:`,
        error,
      );
    }
  };

  effect();
});
