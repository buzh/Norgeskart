import { retryBlankTileLoadFunction } from './loadFunctions';
import { BackgroundLayer } from './types';

export const elevationBackgroundLayers: BackgroundLayer[] = [
  {
    type: 'WMS',
    layerName: 'lidarHillshade',
    url: 'https://wms.geonorge.no/skwms1/wms.hoyde-dtm-nhm-topobathy-25833',
    props: {
      LAYERS: 'NHM_DTM_TOPOBATHY_25833:skyggerelieff',
      VERSION: '1.3.0',
    },
    tileLoadFunction: retryBlankTileLoadFunction,
  },
];
