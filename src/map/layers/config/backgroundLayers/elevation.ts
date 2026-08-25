import { retryTileLoadFunction } from './loadFunctions';
import { BackgroundLayer } from './types';

export const elevationBackgroundLayers: BackgroundLayer[] = [
  {
    type: 'WMS',
    layerName: 'lidarHillshade',
    url: 'https://wms.geonorge.no/skwms1/wms.hoyde-dtm-nhm-topobathy-25833',
    // No TILED — the on-the-fly DTM WMS has no server-side tile cache to
    // align to, and setting TILED=true makes MapServer return an empty PNG
    // for any request that doesn't match its expected grid.
    props: {
      LAYERS: 'NHM_DTM_TOPOBATHY_25833:skyggerelieff',
      VERSION: '1.3.0',
    },
    tileLoadFunction: retryTileLoadFunction,
  },
];
