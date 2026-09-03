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
  LIDAR_PROJECT_WMS_URL,
} from './lidarProjects';
import { retryBlankTileLoadFunction } from './loadFunctions';
import {
  BackgroundLayer,
  EmptyBackgroundLayer,
  WMSBackgroundLayer,
} from './types';
import {
  clearBackgroundLayer,
  getLayerFromConfig,
  getWMSLayer,
  getWMTSLayer,
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

      // Build the topo base in parallel with the top layer when the
      // requested layer needs a fallback underneath — cheaper than doing
      // them sequentially and keeps the swap atomic (both built before
      // swapBackgroundLayers runs).
      const baseTopoConfig = NEEDS_TOPO_BASE.has(layerName)
        ? allConfiguredBackgroundLayers.find((l) => l.layerName === 'topo')
        : undefined;

      const [baseLayer, topLayer] = await Promise.all([
        baseTopoConfig
          ? getLayerFromConfig(baseTopoConfig, projection)
          : Promise.resolve(null),
        layerConfig.type === 'WMTS'
          ? getWMTSLayer(layerConfig, projection)
          : layerConfig.type === 'WMS'
            ? Promise.resolve(getWMSLayer(layerConfig))
            : Promise.resolve<TileLayer | null>(null),
      ]);

      if (!topLayer) return;

      swapBackgroundLayers(baseLayer, topLayer);
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
