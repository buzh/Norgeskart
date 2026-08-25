// Send a tiny 16×16 GetMap probe against a per-project LiDAR WMS layer to
// learn whether Kartverket's renderer actually returns imagery for that
// project at the current view center + zoom. Results feed the picker so
// projects with declared bbox coverage but blank tiles at this zoom
// don't clutter the list.
//
// Cache is bucketed in 2 km grid cells × integer zoom so panning within
// the same area re-uses prior probes. wmscache also caches upstream, so
// re-visits are free even across sessions.

import { LIDAR_PROJECT_WMS_URL } from '../layers/config/backgroundLayers/lidarProjects';

export type Coverage = 'covered' | 'blank';

const BUCKET_SIZE_M = 2000;
// 16×16 was too small — real hillshade tiles compressed to just ~250 B,
// indistinguishable from Kartverket's ~83 B "no data" PNG. At 32×32 the
// gap is ~10× (blank ~83 B vs real ~500–2000 B), so 250 B is a safe cut.
const PROBE_PIXELS = 32;
const BLANK_THRESHOLD_BYTES = 250;

const bucketKey = (
  projectId: string,
  x: number,
  y: number,
  zoom: number,
): string =>
  `${projectId}@${Math.floor(x / BUCKET_SIZE_M)}:${Math.floor(
    y / BUCKET_SIZE_M,
  )}@z${Math.round(zoom)}`;

const cache = new Map<string, Coverage>();
const pending = new Map<string, Promise<Coverage>>();

export const readCoverage = (
  projectId: string,
  centerX: number,
  centerY: number,
  zoom: number,
): Coverage | undefined => cache.get(bucketKey(projectId, centerX, centerY, zoom));

export const probeCoverage = (
  projectId: string,
  centerX: number,
  centerY: number,
  resolution: number,
  zoom: number,
  projection: string,
): Promise<Coverage> => {
  const k = bucketKey(projectId, centerX, centerY, zoom);
  const cached = cache.get(k);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(k);
  if (inflight) return inflight;

  const half = (PROBE_PIXELS / 2) * resolution;
  const bbox = [
    centerX - half,
    centerY - half,
    centerX + half,
    centerY + half,
  ].join(',');
  const url =
    `${LIDAR_PROJECT_WMS_URL}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
    `&LAYERS=${encodeURIComponent(`${projectId}:skyggerelieff`)}` +
    `&CRS=${encodeURIComponent(projection)}&BBOX=${bbox}` +
    `&WIDTH=${PROBE_PIXELS}&HEIGHT=${PROBE_PIXELS}` +
    `&FORMAT=image/png&STYLES=&TRANSPARENT=true`;

  const p = (async (): Promise<Coverage> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return 'blank';
      const blob = await res.blob();
      return blob.size < BLANK_THRESHOLD_BYTES ? 'blank' : 'covered';
    } catch {
      return 'blank';
    }
  })().then((cov) => {
    cache.set(k, cov);
    pending.delete(k);
    return cov;
  });

  pending.set(k, p);
  return p;
};
