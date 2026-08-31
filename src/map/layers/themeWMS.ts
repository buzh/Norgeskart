import ImageLayer from 'ol/layer/Image.js';
import TileLayer from 'ol/layer/Tile';
import { ImageWMS, TileWMS } from 'ol/source';
import type {
  ThemeLayerConfig,
  ThemeLayerDefinition,
} from './themeLayerConfigApi';
import {
  getCategoryById,
  getEffectiveWmsUrl,
  getParentCategory,
} from './themeLayerConfigApi';

// Fork keeps only Kulturminner theme layers.
export type ThemeLayerName =
  | 'heritageSites'
  | 'culturalEnvironments'
  | 'sefrakBuildings'
  | 'protectedBuildings'
  | 'userReportedHeritage';

export const createThemeLayerFromConfig = (
  config: ThemeLayerConfig,
  layerDef: ThemeLayerDefinition,
  projection: string,
): TileLayer | ImageLayer<ImageWMS> | null => {
  if (!layerDef.layers) {
    console.warn(`Layer ${layerDef.id} has no WMS layers defined`);
    return null;
  }

  const wmsUrl = getEffectiveWmsUrl(config, layerDef);

  const category = getCategoryById(config, layerDef.categoryId);
  const parentCategory = category
    ? getParentCategory(config, category)
    : undefined;
  const infoFormat =
    layerDef.infoFormat || category?.infoFormat || parentCategory?.infoFormat;
  const featureInfoImageBaseUrl =
    layerDef.featureInfoImageBaseUrl ||
    category?.featureInfoImageBaseUrl ||
    parentCategory?.featureInfoImageBaseUrl;
  const featureInfoFields =
    layerDef.featureInfoFields ||
    category?.featureInfoFields ||
    parentCategory?.featureInfoFields;

  const layerProperties = {
    id: `theme.${layerDef.id}`,
    queryable: layerDef.queryable ?? false,
    layerTitle: layerDef.name.nb || layerDef.id,
    ...(infoFormat ? { infoFormat } : {}),
    ...(featureInfoImageBaseUrl ? { featureInfoImageBaseUrl } : {}),
    ...(featureInfoFields ? { featureInfoFields } : {}),
  };

  const extraWmsParams = {
    ...parentCategory?.extraWmsParams,
    ...category?.extraWmsParams,
    ...layerDef.extraWmsParams,
  };

  const minZoom =
    layerDef.minZoom ?? category?.minZoom ?? parentCategory?.minZoom;

  const wmsParams = {
    LAYERS: layerDef.layers,
    TRANSPARENT: true,
    SRS: projection,
    STYLES: layerDef.styles ?? '',
    FILTER: layerDef.filter ? layerDef.filter : undefined,
    ...extraWmsParams,
  };

  if (layerDef.singleImage) {
    return new ImageLayer({
      source: new ImageWMS({
        url: wmsUrl,
        params: wmsParams,
        projection: projection,
      }),
      properties: layerProperties,
      ...(minZoom !== undefined ? { minZoom } : {}),
    });
  }

  return new TileLayer({
    source: new TileWMS({
      url: wmsUrl,
      params: { ...wmsParams, TILED: true },
      projection: projection,
      cacheSize: 512,
    }),
    properties: layerProperties,
    preload: 2,
    ...(minZoom !== undefined ? { minZoom } : {}),
  });
};
