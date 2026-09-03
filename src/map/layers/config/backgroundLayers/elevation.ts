import { LidarModel, NATIONAL_WMS } from './lidarProjects';
import { retryBlankTileLoadFunction } from './loadFunctions';
import { WMSBackgroundLayer } from './types';

// The national mosaic can show any style the WMS publishes (see
// lidarProjects.ts's fetchNationalLidarStyles) — the TopBar style
// pulldown picks it via activeLidarStyleAtom. On the DOM side that's
// skyggerelieff and nothing else.
export const buildNationalLidarConfig = (
  style: string,
  model: LidarModel,
): WMSBackgroundLayer => ({
  type: 'WMS',
  layerName: 'lidarHillshade',
  // Same-origin via the /wms/geonorge/* Caddy handler → wmscache →
  // wms.geonorge.no. Same-origin avoids CORS issues seen when calling
  // wms.geonorge.no from fetch(), and wmscache holds a 25 GB LRU of
  // successful, non-blank tile responses.
  url: NATIONAL_WMS[model].url,
  props: {
    LAYERS: `${NATIONAL_WMS[model].prefix}:${style}`,
    VERSION: '1.3.0',
  },
  tileLoadFunction: retryBlankTileLoadFunction,
});
