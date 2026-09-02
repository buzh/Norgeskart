// Relevance tiering for the LiDAR project picker and footprint overlay:
// decides which viewport candidates surface immediately ("primary") vs
// sit behind the "flere lag" overflow ("secondary"). Nothing is ever
// excluded outright — these are priority rules the user can dial back
// via lidarFilterSettingsAtom — and a render cap bounds cost regardless
// of how many candidates a fully-zoomed-out viewport turns up.

import { atom } from 'jotai';
import { Geometry } from 'ol/geom';
import { LidarProject } from './lidarProjects';

export type LidarFilterSettings = {
  // Projects older than this are demoted, unless the density grandfather
  // exception below applies.
  minYear: number;
  // A project with pointDensity >= 5 pkt/m² counts as meeting the year
  // bar even if it's a bit older than minYear.
  grandfatherDense: boolean;
  // Projects whose real footprint area is smaller than this fraction of
  // the current viewport area are demoted.
  minAreaRatio: number;
};

export const DEFAULT_LIDAR_FILTERS: LidarFilterSettings = {
  minYear: 2015,
  grandfatherDense: true,
  minAreaRatio: 0.1,
};

const GRANDFATHER_DENSITY_PKT = 5;

const densityValue = (d: string | null): number => {
  if (!d) return 0;
  const m = d.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

export const meetsYearBar = (
  project: LidarProject,
  filters: LidarFilterSettings,
): boolean => {
  if (project.year == null) return false;
  if (project.year >= filters.minYear) return true;
  return (
    filters.grandfatherDense &&
    densityValue(project.pointDensity) >= GRANDFATHER_DENSITY_PKT
  );
};

export const meetsSizeBar = (
  areaRatio: number,
  filters: LidarFilterSettings,
): boolean => areaRatio >= filters.minAreaRatio;

// How many entries (primary + secondary combined) ever get a list row —
// and, by extension, a hoverable footprint. Applied after the WFS
// response is in, so it bounds list length only; download and parse cost
// is bounded by the extent guard in map/lidarFootprintsLayer.ts. Not
// user-adjustable: a performance bound, not a relevance preference.
export const RENDER_CAP = 25;

type RelevanceInput = {
  project: LidarProject;
  areaRatio: number;
};

// `sorted` must already be in display-priority order (newest/densest
// first — see sortProjectsByRelevance in lidarProjects.ts); this only
// tiers and caps, it doesn't re-sort.
export const classifyRelevance = <T extends RelevanceInput>(
  sorted: T[],
  filters: LidarFilterSettings,
): { primary: T[]; secondary: T[] } => {
  const primary: T[] = [];
  const secondary: T[] = [];
  for (const entry of sorted) {
    const isPrimary =
      meetsYearBar(entry.project, filters) &&
      meetsSizeBar(entry.areaRatio, filters);
    (isPrimary ? primary : secondary).push(entry);
  }
  const cappedPrimary = primary.slice(0, RENDER_CAP);
  const remaining = RENDER_CAP - cappedPrimary.length;
  const cappedSecondary = remaining > 0 ? secondary.slice(0, remaining) : [];
  return { primary: cappedPrimary, secondary: cappedSecondary };
};

export const lidarFilterSettingsAtom = atom<LidarFilterSettings>(
  DEFAULT_LIDAR_FILTERS,
);

// One entry per viewport candidate, shared by the TopBar picker (list
// rows) and the map footprint layer (drawn shapes) so both read off a
// single fetch/classify pass instead of duplicating the WFS call.
export type LidarViewportEntry = {
  project: LidarProject;
  // Real WFS polygon parts; empty for the rare project with no match
  // (still listed, just nothing drawn on the map).
  geometries: Geometry[];
  areaRatio: number;
};

export type LidarViewportStatus =
  // Not in LiDAR mode — nothing fetched, nothing drawn.
  | 'idle'
  | 'loading'
  | 'ready'
  // Viewport too wide to ask the WFS about; the user has to zoom in
  // before coverage can be shown at all.
  | 'zoomedOut'
  | 'error';

export type LidarViewportState = {
  status: LidarViewportStatus;
  primary: LidarViewportEntry[];
  secondary: LidarViewportEntry[];
};

export const emptyLidarViewport = (
  status: LidarViewportStatus,
): LidarViewportState => ({ status, primary: [], secondary: [] });

export const lidarViewportAtom = atom<LidarViewportState>(
  emptyLidarViewport('idle'),
);

// Whether the TopBar's LiDAR dataset pulldown is open. The footprint
// polygons are a picking aid, not a persistent overlay — they'd only
// clutter the terrain the user came to read — so both the WFS fetch and
// the drawn shapes hang off this, and go away the moment the pulldown
// closes (selecting a dataset closes it).
export const lidarPickerOpenAtom = atom(false);

// The pulldown row the pointer (or keyboard focus) is currently on. Only
// that one project's footprint is drawn, alongside the active dataset's —
// drawing all of them at once turned the map into an unreadable stack of
// overlapping outlines, and the whole point of the overlay is answering
// "where is *this* row" while the user runs down the list.
export const hoveredLidarProjectIdAtom = atom<string | null>(null);
