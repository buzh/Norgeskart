export type WMSLayerName =
  | 'lidarHillshade'
  // Dynamic per-acquisition LiDAR project. The concrete project + style
  // come from activeLidarProjectAtom, not from a static layer config.
  | 'lidarProject'
  // Transparent roads/place-names overlay for hybrid mode. Never a
  // background *choice* — it's always stacked on top of one, so it
  // isn't in allConfiguredBackgroundLayers and backgroundLayerAtom is
  // never set to it.
  | 'topoOverlay';
export type EmptyLayerName = 'empty';
export type WMTSLayerName = 'topo';

export type BackgroundLayerName =
  WMTSLayerName | WMSLayerName | EmptyLayerName;
