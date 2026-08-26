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

// Target ground resolution in metres/pixel. The user picks this per run.
// The panel exposes discrete options (0.15/0.25/0.5/1/2 m/px) and shows
// the resulting output pixel size for the current selection.
export const lidarExtractResolutionAtom = atom<number>(0.5);

// One canvas per (source, style). The canvas is the composed output the
// panel previews and lets the user download.
export type LidarCanvas = {
  id: string;
  sourceKey: string;
  sourceLabel: string;
  style: string;
  widthPx: number;
  heightPx: number;
  canvas: HTMLCanvasElement;
  tilesTotal: number;
  tilesDone: number;
  tilesFailed: number;
  status: 'pending' | 'fetching' | 'done' | 'error';
  error?: string;
};

export type LidarExtractRun = {
  runId: number;
  bbox25833: [number, number, number, number];
  resolution: number;
  canvases: LidarCanvas[];
  startedAt: number;
};

export const lidarExtractRunAtom = atom<LidarExtractRun | null>(null);

// Enumerated sources for the current selection. Kept as a plain atom
// rather than derived from selection because enumeration is async
// (reads GetCapabilities); the panel populates it after the box is drawn.
export const lidarExtractSourcesAtom = atom<LidarSource[] | null>(null);
