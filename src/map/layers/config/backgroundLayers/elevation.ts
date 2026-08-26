import { retryBlankTileLoadFunction } from './loadFunctions';
import { BackgroundLayer } from './types';

export const elevationBackgroundLayers: BackgroundLayer[] = [
  {
    type: 'WMS',
    layerName: 'lidarHillshade',
    // Same-origin via the /wms/geonorge/* Caddy handler → wmscache →
    // wms.geonorge.no. Same-origin avoids CORS issues seen when calling
    // wms.geonorge.no from fetch(), and wmscache holds a 25 GB LRU of
    // successful, non-blank tile responses.
    url: '/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833',
    props: {
      LAYERS: 'NHM_DTM_TOPOBATHY_25833:skyggerelieff',
      VERSION: '1.3.0',
    },
    tileLoadFunction: retryBlankTileLoadFunction,
  },
];
