import { ThemeLayerConfig } from '../../themeLayerConfigApi';

export const elevationConfig: ThemeLayerConfig = {
  categories: [
    {
      id: 'elevation',
      groupid: 21,
      name: {
        nb: 'Høydedata',
        nn: 'Høgdedata',
        en: 'Elevation data',
      },
    },
  ],
  layers: [
    {
      id: 'elevationHillshade',
      name: {
        nb: 'Terrengskygge (laser)',
        nn: 'Terrengskygge (laser)',
        en: 'Hillshade (LiDAR)',
      },
      wmsUrl:
        'https://wms.geonorge.no/skwms1/wms.hoyde-dtm-nhm-topobathy-25833',
      layers: 'NHM_DTM_TOPOBATHY_25833:skyggerelieff',
      categoryId: 'elevation',
      groupid: 21,
      queryable: false,
      useLegendGraphic: true,
    },
  ],
};
