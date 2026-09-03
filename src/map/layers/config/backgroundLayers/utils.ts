import { getDefaultStore } from 'jotai';
import { WMTSCapabilities } from 'ol/format';
import type BaseLayer from 'ol/layer/Base';
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
      // crossOrigin keeps the map canvas untainted so the lokalitet
      // skjermbilde can toBlob() it — cache.kartverket.no sends ACAO:*.
      // Every other raster source is same-origin via the /wms/* proxies.
      source: new WMTS({ ...layerOptions, crossOrigin: 'anonymous' }),
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

const isBackgroundLayer = (layer: BaseLayer): boolean => {
  const layerId = layer.get('id');
  return !layerId || String(layerId).startsWith('bg.');
};

// Identity of what a background layer is showing: equal signatures mean
// equal pixels. Cycling styles or datasets rebuilds the whole stack on
// every keypress, but the topo base and the faded LiDAR fallback under
// the active dataset are nearly always unchanged between steps —
// rebuilding those throws away a screenful of loaded tiles and refetches
// them for no visible difference.
const layerSignature = (
  config: BackgroundLayer,
  projection: string,
): string | null => {
  if (config.type === 'WMTS') return `wmts|${config.layerName}|${projection}`;
  if (config.type === 'WMS') {
    return `wms|${config.url}|${JSON.stringify(config.props)}|${projection}`;
  }
  return null;
};

// The layer for this config, reusing the one already on the map when it
// would render identically. Callers must set opacity explicitly on what
// comes back: a reused layer may still be carrying the fade from an
// earlier swap.
export const buildOrReuseBackgroundLayer = async (
  config: BackgroundLayer,
  projection: string,
): Promise<TileLayer | null> => {
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  const signature = layerSignature(config, projection);
  if (signature) {
    const existing = map
      .getLayers()
      .getArray()
      .find((l) => l.get('sig') === signature);
    if (existing) return existing as TileLayer;
  }
  const layer = await getLayerFromConfig(config, projection);
  if (layer && signature) layer.set('sig', signature);
  return layer;
};

// How long the outgoing stack may hang around waiting for a render that
// never comes — a tile stuck loading, a backgrounded tab. Generous,
// because the LiDAR tile loader retries blank responses with backoff
// (see loadFunctions.ts) and a slow-but-real swap should still be
// gapless; the only cost of waiting is two background stacks in memory.
const SWAP_TIMEOUT_MS = 8000;

// What a layer on its way out is dimmed to, immediately, for as long as
// it hangs around. A per-project dataset usually covers only part of the
// screen, and an outgoing full-screen layer at full opacity behind it is
// indistinguishable from real coverage — the edge of what you just
// selected has to be readable before its tiles are even in.
const OUTGOING_OPACITY = 0.35;

// Cancels the pending retirement of the previous swap, if any.
let cancelPendingRetire: (() => void) | null = null;

// Replace the background stack without ever showing a gap. Both lists
// are bottom-first and describe where the incoming layers sit relative
// to the outgoing ones that are still fading out: `under` goes below
// them (the topo base, the faded national mosaic — context that the
// outgoing dataset should keep covering until it goes away), `over`
// above them (the dataset being featured, and the hybrid overlay on top
// of that, which must not be buried by a layer on its way out).
//
// Removing the old layers first — which is what this used to do — means
// the map has nothing but the topo base to draw while the new LiDAR
// tiles load, so cycling styles or datasets flashes topo between every
// step. Instead the outgoing layers stay put (faded, see above) and are
// removed only once the map reports a complete render with the incoming
// ones in.
export const swapBackgroundLayers = (under: TileLayer[], over: TileLayer[]) => {
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  const layers = [...under, ...over];
  if (layers.length === 0) return;

  // A swap arriving while an earlier one is still retiring: cancel that
  // retirement rather than running it. Its layers are part of this
  // swap's outgoing set anyway, and dropping them now would open the
  // very gap the deferral exists to avoid.
  cancelPendingRetire?.();

  const collection = map.getLayers();
  const outgoing = collection
    .getArray()
    .filter((l) => isBackgroundLayer(l) && !layers.includes(l as TileLayer));

  // Reposition rather than just add: `under` goes to the bottom of the
  // collection in order, `over` on top of everything. Layers that were
  // reused are already somewhere in the collection, and the outgoing
  // ones have to end up *between* the two groups.
  under.forEach((layer, i) => {
    collection.remove(layer);
    collection.insertAt(i, layer);
  });
  for (const layer of over) {
    collection.remove(layer);
    collection.push(layer);
  }

  for (const layer of outgoing) layer.setOpacity(OUTGOING_OPACITY);

  const retire = () => {
    cancelPendingRetire?.();
    for (const layer of outgoing) map.removeLayer(layer);
  };
  const timer = setTimeout(retire, SWAP_TIMEOUT_MS);
  cancelPendingRetire = () => {
    cancelPendingRetire = null;
    clearTimeout(timer);
    map.un('rendercomplete', retire);
  };
  map.on('rendercomplete', retire);
};

export const clearBackgroundLayer = () => {
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  // Nothing is coming in to hide behind, so any deferred removal should
  // just happen now.
  cancelPendingRetire?.();
  // Snapshot: getArray() is the live collection array, and removing
  // while iterating it skips every other entry.
  const allLayers = [...map.getLayers().getArray()];
  allLayers.forEach((layer) => {
    try {
      if (isBackgroundLayer(layer)) {
        map.removeLayer(layer);
      }
    } catch (error) {
      console.error('Error while clearing background layers:', error);
    }
  });
};
