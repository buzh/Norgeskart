import { ThemeLayerConfig } from '../../themeLayerConfigApi';

export const CULTURAL_HERITAGE_LAYER_IDS = new Set([
  'theme.heritageSites',
  'theme.culturalEnvironments',
  'theme.sefrakBuildings',
  'theme.protectedBuildings',
  'theme.userReportedHeritage',
]);

export const culturalHeritageConfig: ThemeLayerConfig = {
  categories: [
    {
      id: 'culturalHeritage',
      groupid: 19,
      name: {
        nb: 'Kulturminner',
        nn: 'Kulturminne',
        en: 'Cultural heritage',
      },
      infoFormat: 'application/vnd.ogc.gml',
      // Kart.ra.no is MapServer; map_resolution acts as a DPI hint and
      // scales symbol sizes / line widths on the server side. 192 = ~2x
      // the default 96 dpi, doubling the "R" icon and related glyphs.
      extraWmsParams: { map_resolution: 192 },
      // Norway has ~300k heritage records; below city-scale zoom the
      // map turns into an unreadable wall of pins. Hide the whole
      // category until the view zooms in past this level.
      minZoom: 8,
    },
  ],
  layers: [
    {
      id: 'heritageSites',
      name: {
        nb: 'Lokaliteter og enkeltminner',
        nn: 'Lokalitetar og enkeltminne',
        en: 'Heritage sites and monuments',
      },
      wmsUrl: '/wms/ra/kulturminner2',
      layers: 'Kulturminner',
      categoryId: 'culturalHeritage',
      groupid: 19,
      queryable: true,
      useLegendGraphic: true,
    },
    {
      id: 'culturalEnvironments',
      name: {
        nb: 'Kulturmiljøer',
        nn: 'Kulturmiljø',
        en: 'Cultural environments',
      },
      wmsUrl: '/wms/ra/kulturmiljoer',
      layers: 'Kulturmiljoer',
      categoryId: 'culturalHeritage',
      groupid: 19,
      queryable: true,
      useLegendGraphic: true,
    },
    {
      id: 'sefrakBuildings',
      name: {
        nb: 'SEFRAK-bygninger',
        nn: 'SEFRAK-bygningar',
        en: 'SEFRAK buildings',
      },
      wmsUrl: '/wms/ra/sefrak',
      layers: 'SEFRAK',
      categoryId: 'culturalHeritage',
      groupid: 19,
      queryable: true,
      useLegendGraphic: true,
    },
    {
      id: 'protectedBuildings',
      name: {
        nb: 'Freda bygninger',
        nn: 'Freda bygningar',
        en: 'Listed buildings',
      },
      wmsUrl: '/wms/ra/freda_bygninger',
      layers: 'Freda_bygninger_WMS',
      categoryId: 'culturalHeritage',
      groupid: 19,
      queryable: true,
      useLegendGraphic: true,
    },
    {
      id: 'userReportedHeritage',
      name: {
        nb: 'Brukerminner',
        nn: 'Brukarminne',
        en: 'User-reported heritage',
      },
      wmsUrl: '/wms/ra/brukerminner',
      layers: 'Brukerminner_WMS',
      categoryId: 'culturalHeritage',
      groupid: 19,
      queryable: true,
      useLegendGraphic: true,
    },
  ],
};
