import { ThemeLayerConfig } from '../../themeLayerConfigApi';

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
      wmsUrl: 'https://kart.ra.no/wms/kulturminner2',
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
      wmsUrl: 'https://kart.ra.no/wms/kulturmiljoer',
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
      wmsUrl: 'https://kart.ra.no/wms/sefrak',
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
      wmsUrl: 'https://kart.ra.no/wms/freda_bygninger',
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
      wmsUrl: 'https://kart.ra.no/wms/brukerminner',
      layers: 'Brukerminner_WMS',
      categoryId: 'culturalHeritage',
      groupid: 19,
      queryable: true,
      useLegendGraphic: true,
    },
  ],
};
