import { getDefaultStore } from 'jotai';
import { WMTSCapabilities } from 'ol/format';
import TileLayer from 'ol/layer/Tile';
import TileWMS from 'ol/source/TileWMS';
import WMTS, { optionsFromCapabilities } from 'ol/source/WMTS';
import { mapAtom } from '../../../atoms';
import { backgroundLayerCapabilitiesCacheAtom } from './atoms';
import {
  BackgroundLayer,
  WMSBackgroundLayer,
  WMTSBackgroundLayer,
} from './types';

export const getWMTSLayer = async (
  layerConfig: WMTSBackgroundLayer,
  projection = 'EPSG:25833',
) => {
  const store = getDefaultStore();

  try {
    const cache = store.get(backgroundLayerCapabilitiesCacheAtom);
    let capabilitiesText: string;
    if (cache[layerConfig.layerName]) {
      capabilitiesText = cache[layerConfig.layerName]!;
    } else {
      const capabilitiesResponse = await fetch(
        layerConfig.provider.capabilitiesUrl,
      );
      if (!capabilitiesResponse.ok) {
        throw new Error(
          `Failed to fetch capabilities for layer ${layerConfig.layerName}: ${capabilitiesResponse.statusText}`,
        );
      }
      capabilitiesText = await capabilitiesResponse.text();
      store.set(backgroundLayerCapabilitiesCacheAtom, {
        ...cache,
        [layerConfig.layerName]: capabilitiesText,
      });
    }
    const parser = new WMTSCapabilities();
    const capabilities = parser.read(capabilitiesText);
    const layerOptions = optionsFromCapabilities(capabilities, {
      layer: layerConfig.layerName,
      projection,
    });

    if (!layerOptions) {
      throw new Error(
        `Layer ${layerConfig.layerName} not found in capabilities`,
      );
    }

    const layer = new TileLayer({
      source: new WMTS({ ...layerOptions }),
      properties: { id: `bg.${layerConfig.layerName}` },
      preload: 2,
    });

    return layer;
  } catch (error) {
    console.error(
      `Error fetching capabilities for layer ${layerConfig.layerName}:`,
      error,
    );
    return null;
  }
};

export const getWMSLayer = (layerConfig: WMSBackgroundLayer): TileLayer => {
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  const projection = map.getView().getProjection().getCode();
  const properties = { id: `bg.${layerConfig.layerName}` };

  const source = new TileWMS({
    url: layerConfig.url,
    params: { ...layerConfig.props, SRS: projection },
  });
  if (layerConfig.tileLoadFunction) {
    source.setTileLoadFunction(layerConfig.tileLoadFunction);
  }
  return new TileLayer({ source, properties, preload: 2 });
};

export const getLayerFromConfig = async (
  layerConfig: BackgroundLayer,
  projection?: string,
): Promise<TileLayer | null> => {
  if (layerConfig.type === 'WMTS') {
    return await getWMTSLayer(layerConfig, projection);
  }
  if (layerConfig.type === 'WMS') {
    return getWMSLayer(layerConfig);
  }
  console.warn(`Unsupported layer type for layerconfig: ${layerConfig}`);
  return null;
};

export const clearBackgroundLayer = () => {
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  const allLayers = map.getLayers().getArray();
  allLayers.forEach((layer) => {
    try {
      const layerId = layer.get('id');
      if (!layerId || layerId.startsWith('bg.')) {
        map.removeLayer(layer);
      }
    } catch (error) {
      console.error('Error while clearing background layers:', error);
    }
  });
};
