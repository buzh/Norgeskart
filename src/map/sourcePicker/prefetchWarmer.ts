// Warms wmscache with GetMap requests aligned to OpenLayers' default tile
// grid, so activating a lidar source responds with X-Cache-Status: HIT
// (~100 ms) instead of an upstream fetch (~1–2 s).
//
// Only lidar projects benefit — topo/nasjonal mosaikk already come from
// their own cache paths. Called from the SourcePicker on every view
// change; each (project, z, x, y) tuple is warmed once per session.

import { get as getProjection } from 'ol/proj';
import { createXYZ } from 'ol/tilegrid';
import {
  DEFAULT_LIDAR_PROJECT_STYLE,
  LIDAR_PROJECT_WMS_URL,
} from '../layers/config/backgroundLayers/lidarProjects';

const TILE_PIXELS = 256;
// Cap so a zoomed-out view (30+ visible tiles × N candidates) doesn't
// spray requests. The user can still zoom in and re-warm the finer level.
const MAX_TILES_PER_PROJECT = 12;

const warmed = new Set<string>();

export const warmLidarProjectTiles = (
  projectId: string,
  viewExtent: [number, number, number, number],
  resolution: number,
  projectionCode: string,
): void => {
  const projection = getProjection(projectionCode);
  if (!projection) return;
  const projExtent = projection.getExtent();
  if (!projExtent) return;
  const tileGrid = createXYZ({ extent: projExtent, tileSize: TILE_PIXELS });
  const z = tileGrid.getZForResolution(resolution);
  const range = tileGrid.getTileRangeForExtentAndZ(viewExtent, z);

  let count = 0;
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let y = range.minY; y <= range.maxY; y++) {
      if (count >= MAX_TILES_PER_PROJECT) return;
      const key = `${projectId}@${z}:${x}:${y}`;
      if (warmed.has(key)) continue;
      warmed.add(key);
      const extent = tileGrid.getTileCoordExtent([z, x, y]);
      const bbox = extent.join(',');
      const url =
        `${LIDAR_PROJECT_WMS_URL}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
        `&LAYERS=${encodeURIComponent(`${projectId}:${DEFAULT_LIDAR_PROJECT_STYLE}`)}` +
        `&CRS=${encodeURIComponent(projectionCode)}&BBOX=${bbox}` +
        `&WIDTH=${TILE_PIXELS}&HEIGHT=${TILE_PIXELS}` +
        `&FORMAT=image/png&STYLES=&TRANSPARENT=true`;
      fetch(url).catch(() => {});
      count++;
    }
  }
};
