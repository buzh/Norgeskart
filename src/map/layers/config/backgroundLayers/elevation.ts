import { NATIONAL_LAYER_PREFIX, NATIONAL_WMS_URL } from './lidarProjects';
import { retryBlankTileLoadFunction } from './loadFunctions';
import { WMSBackgroundLayer } from './types';

// The national mosaic can show any style the WMS publishes (see
// lidarProjects.ts's fetchNationalLidarStyles) — the TopBar style
// pulldown picks it via activeLidarStyleAtom.
export const buildNationalLidarConfig = (style: string): WMSBackgroundLayer => ({
  type: 'WMS',
  layerName: 'lidarHillshade',
  // Same-origin via the /wms/geonorge/* Caddy handler → wmscache →
  // wms.geonorge.no. Same-origin avoids CORS issues seen when calling
  // wms.geonorge.no from fetch(), and wmscache holds a 25 GB LRU of
  // successful, non-blank tile responses.
  url: NATIONAL_WMS_URL,
  props: {
    LAYERS: `${NATIONAL_LAYER_PREFIX}:${style}`,
    VERSION: '1.3.0',
  },
  tileLoadFunction: retryBlankTileLoadFunction,
});
