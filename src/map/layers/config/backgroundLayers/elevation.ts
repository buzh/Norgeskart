import { retryBlankTileLoadFunction } from './loadFunctions';
import { BackgroundLayer } from './types';

export const elevationBackgroundLayers: BackgroundLayer[] = [
  {
    type: 'WMS',
    layerName: 'lidarHillshade',
    // Proxied through Caddy to keep requests same-origin (avoids CORS
    // issues seen with fetch against wms.geonorge.no) and sets up a spot
    // to add HTTP caching later.
    url: '/wms/hoyde-dtm',
    props: {
      LAYERS: 'NHM_DTM_TOPOBATHY_25833:skyggerelieff',
      VERSION: '1.3.0',
    },
    tileLoadFunction: retryBlankTileLoadFunction,
  },
];
