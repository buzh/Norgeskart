export type WMSLayerName =
  | 'lidarHillshade'
  // Dynamic per-acquisition LiDAR project. The concrete project + style
  // come from activeLidarProjectAtom, not from a static layer config.
  | 'lidarProject';
export type EmptyLayerName = 'empty';
export type WMTSLayerName = 'topo';

export type BackgroundLayerName =
  WMTSLayerName | WMSLayerName | EmptyLayerName;

export const mapLegacyBackgroundLayerId = (
  layerId: string,
): BackgroundLayerName | null => {
  const legacyIdMap: Record<string, BackgroundLayerName> = {
    '1001': 'topo',
  };

  return legacyIdMap[layerId] || null;
};
