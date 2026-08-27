import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import TileLayer from 'ol/layer/Tile';
import {
  getUrlParameter,
  setUrlParameter,
} from '../../../../shared/utils/urlUtils';
import { mapAtom } from '../../../atoms';
import { BackgroundLayerName, WMTSLayerName } from '../../backgroundLayers';
import { elevationBackgroundLayers } from './elevation';
import { KvCacheBackgroundLayers } from './kvCache';
import {
  activeLidarProjectAtom,
  DEFAULT_LIDAR_PROJECT_STYLE,
  LIDAR_PROJECT_WMS_URL,
  lidarProjectTileStatsAtom,
} from './lidarProjects';
import { makeRetryBlankTileLoadFunction } from './loadFunctions';
import {
  BackgroundLayer,
  EmptyBackgroundLayer,
  WMSBackgroundLayer,
} from './types';
import {
  clearBackgroundLayer,
  getWMSLayer,
  getWMTSLayer,
} from './utils';

const emptyBackgroundLayer: EmptyBackgroundLayer = {
  type: 'Empty',
  layerName: 'empty',
};

export const allConfiguredBackgroundLayers = [
  emptyBackgroundLayer,
  ...KvCacheBackgroundLayers,
  ...elevationBackgroundLayers,
];

const getDefaultBackgroundLayer = (): BackgroundLayerName => {
  const layerNameFromUrl = getUrlParameter('backgroundLayer');
  const finalLayerName = (layerNameFromUrl || 'topo') as BackgroundLayerName;
  return finalLayerName;
};

export const backgroundLayerCapabilitiesCacheAtom = atom<
  Partial<Record<WMTSLayerName, string>>
>({});

export const backgroundLayerAtom = atom<BackgroundLayerName>(
  getDefaultBackgroundLayer(),
);

const buildLidarProjectConfig = (projectId: string): WMSBackgroundLayer => {
  const store = getDefaultStore();
  store.set(lidarProjectTileStatsAtom, {
    projectId,
    blank: 0,
    total: 0,
  });
  const inner = makeRetryBlankTileLoadFunction({
    onSettled: ({ blank, failed }) => {
      if (failed) return;
      const s = store.get(lidarProjectTileStatsAtom);
      // Only count for the currently-active project — a lingering load
      // from an old project must not skew the new project's stats.
      if (s.projectId !== projectId) return;
      store.set(lidarProjectTileStatsAtom, {
        projectId,
        blank: s.blank + (blank ? 1 : 0),
        total: s.total + 1,
      });
    },
  });
  return {
    type: 'WMS',
    layerName: 'lidarProject',
    url: LIDAR_PROJECT_WMS_URL,
    props: {
      LAYERS: `${projectId}:${DEFAULT_LIDAR_PROJECT_STYLE}`,
      VERSION: '1.3.0',
    },
    tileLoadFunction: inner,
  };
};

export const backgroundLayerAtomEffect = atomEffect((get) => {
  const layerName = get(backgroundLayerAtom);
  // Depend on the active lidar project so switching projects while
  // 'lidarProject' is the background rebuilds the WMS layer.
  const activeLidarProject = get(activeLidarProjectAtom);

  if (layerName === 'empty') {
    clearBackgroundLayer();
    setUrlParameter('backgroundLayer', 'empty');
    return;
  }

  const layerConfig: BackgroundLayer | undefined =
    layerName === 'lidarProject'
      ? activeLidarProject
        ? buildLidarProjectConfig(activeLidarProject.id)
        : undefined
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

      let layer: TileLayer | null = null;
      switch (layerConfig.type) {
        case 'WMTS':
          layer = await getWMTSLayer(
            layerConfig,
            map.getView().getProjection().getCode(),
          );
          break;
        case 'WMS':
          layer = getWMSLayer(layerConfig);
          break;
      }

      if (layer) {
        clearBackgroundLayer();
        map.addLayer(layer);
        setUrlParameter('backgroundLayer', layerName);

        if (layerConfig.moveToExtent) {
          map.getView().fit(layerConfig.moveToExtent, { duration: 200 });
        }
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
