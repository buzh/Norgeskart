// State for the LiDAR-extract tool. Selection lives independently of the
// tool being active so the user can close the panel without losing the
// drawn box, and separately from the "run" (fetch + stitch), which is
// what the panel's preview canvases render from.

import { atom } from 'jotai';
import { LidarSource } from './sources';

// Bbox is captured in three coordinate systems at once so downstream
// consumers don't have to know how to reproject:
//   - map:     current map view projection (for the OL overlay layer)
//   - utm33:   EPSG:25833, the CRS both LiDAR WMS endpoints render in
//   - lonLat:  EPSG:4326, used to filter per-project bboxes
export type LidarExtractSelection = {
  bboxMap: [number, number, number, number];
  mapProjection: string;
  bbox25833: [number, number, number, number];
  bboxLonLat: [number, number, number, number];
};

export const lidarExtractSelectionAtom = atom<LidarExtractSelection | null>(
  null,
);

// One canvas per (source, style). Resolution is chosen per-source based on
// its native detail rather than user-picked (see nativeResolutionMetersPerPx).
export type LidarCanvas = {
  id: string;
  sourceKey: string;
  sourceLabel: string;
  style: string;
  metresPerPx: number; // effective resolution actually rendered at
  widthPx: number;
  heightPx: number;
  canvas: HTMLCanvasElement;
  tilesTotal: number;
  tilesDone: number;
  tilesBlank: number; // responses under the blank-size threshold
  tilesFailed: number; // network / decode failures
  // 'noCoverage' means every completed tile was blank — the source's
  // declared bbox includes this area but no LiDAR data does.
  status: 'pending' | 'fetching' | 'done' | 'noCoverage' | 'error';
  error?: string;
};

export type LidarExtractRun = {
  runId: number;
  bbox25833: [number, number, number, number];
  canvases: LidarCanvas[];
  startedAt: number;
};

export const lidarExtractRunAtom = atom<LidarExtractRun | null>(null);

// Enumerated sources for the current selection. Kept as a plain atom
// rather than derived from selection because enumeration is async
// (reads GetCapabilities); the panel populates it after the box is drawn.
export const lidarExtractSourcesAtom = atom<LidarSource[] | null>(null);
