// Tests whether a per-project LiDAR layer actually has hillshade data at
// a specific map coordinate — used to filter the pulldown from "bbox
// intersects viewport" (imprecise; regional projects like "Vestfold og
// Telemark 5pkt 2021" have a bbox spanning two counties even though the
// real coverage is a scattered polygon) to "actually has pixels here".
//
// Sends a 32×32 WMS GetMap request centered on the viewport and checks
// the response size. Kartverket's DTM WMS returns ~200-byte transparent
// PNGs outside project coverage, and ~500-2000 bytes for real hillshade
// at this scale — a 250-byte cutoff separates them cleanly.
//
// Results are cached per (project, ~500m grid bucket) so re-opening the
// pulldown at a similar view is instant.

import {
  DEFAULT_LIDAR_PROJECT_STYLE,
  LIDAR_PROJECT_WMS_URL,
} from './lidarProjects';

const PROBE_PIXELS = 32;
const BLANK_THRESHOLD_BYTES = 250;
const BUCKET_METRES = 500;

const cache = new Map<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();

const keyFor = (
  projectId: string,
  centerX: number,
  centerY: number,
): string =>
  `${projectId}@${Math.round(centerX / BUCKET_METRES)}:${Math.round(
    centerY / BUCKET_METRES,
  )}`;

export const probeCoverage = (
  projectId: string,
  centerX: number,
  centerY: number,
  resolution: number,
  projection: string,
): Promise<boolean> => {
  const key = keyFor(projectId, centerX, centerY);
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const already = inflight.get(key);
  if (already) return already;

  const half = (PROBE_PIXELS / 2) * resolution;
  const bbox = `${centerX - half},${centerY - half},${centerX + half},${centerY + half}`;
  const url =
    `${LIDAR_PROJECT_WMS_URL}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
    `&LAYERS=${encodeURIComponent(`${projectId}:${DEFAULT_LIDAR_PROJECT_STYLE}`)}` +
    `&CRS=${encodeURIComponent(projection)}` +
    `&BBOX=${bbox}` +
    `&WIDTH=${PROBE_PIXELS}&HEIGHT=${PROBE_PIXELS}` +
    `&FORMAT=image/png&STYLES=&TRANSPARENT=true`;

  const p = (async (): Promise<boolean> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const blob = await res.blob();
      return blob.size > BLANK_THRESHOLD_BYTES;
    } catch {
      return false;
    }
  })().then((covered) => {
    cache.set(key, covered);
    inflight.delete(key);
    return covered;
  });

  inflight.set(key, p);
  return p;
};
