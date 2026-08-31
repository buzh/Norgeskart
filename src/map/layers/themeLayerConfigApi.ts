import { culturalHeritageConfig } from './config/themeLayers/culturalHeritage';

export interface FieldConfig {
  name: string;
  alias?: string;
  type?: 'symbol' | 'link' | 'picture';
  baseurl?: string;
  filetype?: string;
  unit?: string;
  decimals?: number;
}

export interface ThemeLayerCategory {
  id: string;
  groupid: number;
  name: {
    nb: string;
    nn: string;
    en: string;
  };
  wmsUrl?: string;
  parentId?: string;
  infoFormat?: string;
  featureInfoImageBaseUrl?: string;
  featureInfoFields?: FieldConfig[];
  extraWmsParams?: Record<string, string | number | boolean>;
  // OpenLayers layer.minZoom — the layer is visible only when the view
  // zoom is strictly greater than this. Cascades to layers in the
  // category unless the layer sets its own.
  minZoom?: number;
}

export interface ThemeLayerDefinition {
  id: string;
  name: {
    nb: string;
    nn: string;
    en: string;
  };
  wmsUrl?: string;
  legendUrl?: string;
  layers?: string;
  categoryId: string;
  groupid: number;
  queryable?: boolean;
  styles?: string;
  infoFormat?: string;
  featureInfoImageBaseUrl?: string;
  featureInfoFields?: FieldConfig[];
  useLegendGraphic?: boolean;
  legendLayerNames?: string[];
  filter?: string;
  noLegend?: boolean;
  singleImage?: boolean;
  extraWmsParams?: Record<string, string | number | boolean>;
  minZoom?: number;
}

export interface ThemeLayerConfig {
  categories: ThemeLayerCategory[];
  layers: ThemeLayerDefinition[];
}

export const themeLayerConfig: ThemeLayerConfig = culturalHeritageConfig;

export const getThemeLayerById = (
  config: ThemeLayerConfig,
  id: string,
): ThemeLayerDefinition | undefined => {
  return config.layers.find((layer) => layer.id === id);
};

export const getCategoryById = (
  config: ThemeLayerConfig,
  categoryId: string,
): ThemeLayerCategory | undefined => {
  return config.categories.find((cat) => cat.id === categoryId);
};

export const getEffectiveWmsUrl = (
  config: ThemeLayerConfig,
  layer: ThemeLayerDefinition,
): string => {
  if (layer.wmsUrl) {
    return layer.wmsUrl;
  }
  const category = getCategoryById(config, layer.categoryId);
  if (category?.wmsUrl) {
    return category.wmsUrl;
  }
  throw new Error(
    `No wmsUrl found for layer ${layer.id} in category ${layer.categoryId}`,
  );
};

export const getMainCategories = (
  config: ThemeLayerConfig,
): ThemeLayerCategory[] => {
  return config.categories.filter(isMainCategory);
};

export const getSubcategories = (
  config: ThemeLayerConfig,
  parentId: string,
): ThemeLayerCategory[] => {
  return config.categories.filter(
    (cat) => cat.parentId === parentId && !isMainCategory(cat),
  );
};

export const getDirectLayersForCategory = (
  config: ThemeLayerConfig,
  categoryId: string,
): ThemeLayerDefinition[] => {
  return config.layers.filter((layer) => layer.categoryId === categoryId);
};

export const getParentCategory = (
  config: ThemeLayerConfig,
  category: ThemeLayerCategory,
): ThemeLayerCategory | undefined => {
  if (!category.parentId) {
    return undefined;
  }
  return getCategoryById(config, category.parentId);
};

export const isMainCategory = (category: ThemeLayerCategory): boolean => {
  return !category.parentId;
};
