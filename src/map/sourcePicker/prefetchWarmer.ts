// Warms wmscache with GetMap requests so a subsequent source switch
// resolves against upstream cache (~100 ms) rather than a live Kartverket
// fetch (~1–2 s).
//
// Critical: URLs MUST match byte-for-byte what OpenLayers emits when the
// real layer is added, because wmscache keys on the full raw request URI
// (default proxy_cache_key). We therefore build the URLs by constructing
// a TileWMS with the same params as `getWMSLayer` and asking it for the
// tile URLs directly, rather than hand-rolling the query string.
//
// Requests are throttled globally to a small concurrency to avoid
// tripping Kartverket's upstream rate-limiter (observed as 502s).

import { get as getProjection } from 'ol/proj';
import TileWMS from 'ol/source/TileWMS';
import {
  DEFAULT_LIDAR_PROJECT_STYLE,
  LIDAR_PROJECT_WMS_URL,
} from '../layers/config/backgroundLayers/lidarProjects';

const MAX_TILES_PER_PROJECT = 6;
const MAX_CONCURRENT = 3;

const warmed = new Set<string>();
const queue: Array<() => Promise<void>> = [];
let inflight = 0;

const drain = () => {
  while (inflight < MAX_CONCURRENT && queue.length > 0) {
    const task = queue.shift()!;
    inflight++;
    task().finally(() => {
      inflight--;
      drain();
    });
  }
};

export const warmLidarProjectTiles = (
  projectId: string,
  viewExtent: [number, number, number, number],
  resolution: number,
  projectionCode: string,
): void => {
  const projection = getProjection(projectionCode);
  if (!projection) return;

  // Same params `getWMSLayer` (utils.ts) hands to TileWMS for the real
  // layer — LAYERS, VERSION from the layer config, SRS merged in by the
  // helper. Any deviation here means a different URL and a cache miss.
  const source = new TileWMS({
    url: LIDAR_PROJECT_WMS_URL,
    params: {
      LAYERS: `${projectId}:${DEFAULT_LIDAR_PROJECT_STYLE}`,
      VERSION: '1.3.0',
      SRS: projectionCode,
    },
    projection,
  });
  const tileUrlFunction = source.getTileUrlFunction();
  const tileGrid = source.getTileGridForProjection(projection);
  const z = tileGrid.getZForResolution(resolution);
  const range = tileGrid.getTileRangeForExtentAndZ(viewExtent, z);

  // Iterate outward from the range's centre so the middle of the viewport
  // (what the user actually looks at) warms first, before the throttled
  // queue fills.
  const cx = Math.floor((range.minX + range.maxX) / 2);
  const cy = Math.floor((range.minY + range.maxY) / 2);
  const coords: Array<[number, number]> = [];
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let y = range.minY; y <= range.maxY; y++) {
      coords.push([x, y]);
    }
  }
  coords.sort(
    (a, b) =>
      Math.abs(a[0] - cx) + Math.abs(a[1] - cy) -
      (Math.abs(b[0] - cx) + Math.abs(b[1] - cy)),
  );

  // Match OL's runtime pixel ratio: on a hi-DPI display OL doubles WIDTH
  // and HEIGHT (and may add DPI/MAP_RESOLUTION), so warming at pixelRatio=1
  // stores tiles under a completely different cache key than the ones the
  // real layer later requests.
  const pixelRatio = typeof window !== 'undefined'
    ? window.devicePixelRatio || 1
    : 1;

  let count = 0;
  for (const [x, y] of coords) {
    if (count >= MAX_TILES_PER_PROJECT) return;
    const key = `${projectId}@${z}:${x}:${y}`;
    if (warmed.has(key)) continue;
    warmed.add(key);
    count++;
    const url = tileUrlFunction([z, x, y], pixelRatio, projection);
    if (!url) continue;
    queue.push(() =>
      fetch(url)
        .then(() => undefined)
        .catch(() => undefined),
    );
  }
  drain();
};
