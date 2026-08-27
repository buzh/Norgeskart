import { BackgroundLayerName } from '../layers/backgroundLayers';
import { allConfiguredBackgroundLayers } from '../layers/config/backgroundLayers/atoms';
import { ProjectionIdentifier } from '../projections/types';

const backgroundLayerOrder = new Map<BackgroundLayerName, number>([
  ['topo', 1],
  ['lidarHillshade', 2],
]);

const sortBackgroundLayers = (
  a: BackgroundLayerName,
  b: BackgroundLayerName,
) => {
  const priorityA = backgroundLayerOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
  const priorityB = backgroundLayerOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
  if (priorityA !== priorityB) return priorityA - priorityB;
  return a.localeCompare(b);
};

export const getAvailableBackgroundLayers = (
  currentProjection: ProjectionIdentifier,
) =>
  allConfiguredBackgroundLayers
    .filter(
      (layer) =>
        layer.showForProjections == null ||
        layer.showForProjections.includes(currentProjection),
    )
    .map((layer) => layer.layerName)
    .sort(sortBackgroundLayers);
