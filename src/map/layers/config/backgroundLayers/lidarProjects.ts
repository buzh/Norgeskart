// Fetches and parses the per-project LiDAR WMS GetCapabilities from
// Kartverket, exposing one entry per acquisition (project) with its
// bounding box, year, point density, and available styled variants.
//
// The XML is proxied + long-cached through wmscache; we additionally
// keep a week-long localStorage cache to avoid re-parsing on every load.

import { atom } from 'jotai';

export type LidarProject = {
  // Full WMS layer-name prefix, e.g. "Vestfold 10pkt 2025".
  id: string;
  projectName: string;
  year: number | null;
  pointDensity: string | null;
  bboxLonLat: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  styles: string[]; // e.g. ["skyggerelieff", "helning_grader", ...]
};

const CAPS_URL =
  '/wms/geonorge/wms.hoyde-dtm-prosjekt?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0';
// Bump when the parser output shape or filtering changes so cached
// entries from an older schema are ignored.
const STORAGE_KEY = 'lidarProjects.v3';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The project the picker most recently activated as the background source.
// Read by the background-layer effect when backgroundLayerAtom is
// 'lidarProject' to build the actual WMS request.
export const activeLidarProjectAtom = atom<LidarProject | null>(null);

export const LIDAR_PROJECT_WMS_URL = '/wms/geonorge/wms.hoyde-dtm-prosjekt';
export const DEFAULT_LIDAR_PROJECT_STYLE = 'skyggerelieff';

// Rolling counters for tiles observed on the currently-active project.
// Kartverket occasionally publishes datasets whose renderer returns only
// blank tiles below some zoom (see NDH Skien 5pkt 2022) — the picker
// watches this atom to warn the user when that happens.
export type LidarProjectTileStats = {
  projectId: string | null;
  blank: number;
  total: number;
};
export const lidarProjectTileStatsAtom = atom<LidarProjectTileStats>({
  projectId: null,
  blank: 0,
  total: 0,
});

type CachedEntry = { ts: number; projects: LidarProject[] };

let inflight: Promise<LidarProject[]> | null = null;

export function fetchLidarProjects(): Promise<LidarProject[]> {
  if (inflight) return inflight;
  const cached = readCache();
  if (cached) return Promise.resolve(cached);
  inflight = (async () => {
    const res = await fetch(CAPS_URL);
    if (!res.ok) throw new Error(`GetCapabilities HTTP ${res.status}`);
    const xml = await res.text();
    const projects = parseCapabilities(xml);
    writeCache(projects);
    return projects;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function parseCapabilities(xmlText: string): LidarProject[] {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('GetCapabilities XML parse error');
  }

  const grouped = new Map<
    string,
    { styles: Set<string>; bboxes: [number, number, number, number][] }
  >();

  for (const layer of Array.from(doc.getElementsByTagName('Layer'))) {
    const name = layer
      .getElementsByTagName('Name')[0]
      ?.textContent?.trim();
    if (!name || !name.includes(':')) continue;
    const colon = name.indexOf(':');
    const projectName = name.slice(0, colon);
    const style = name.slice(colon + 1);
    const bbox = readBboxFromLayerOrAncestor(layer);
    const entry = grouped.get(projectName) ?? {
      styles: new Set<string>(),
      bboxes: [],
    };
    entry.styles.add(style);
    if (bbox) entry.bboxes.push(bbox);
    grouped.set(projectName, entry);
  }

  const out: LidarProject[] = [];
  for (const [projectName, { styles, bboxes }] of grouped) {
    const bboxLonLat = unionBbox(bboxes);
    if (!bboxLonLat) continue;
    // Skip photogrammetry-derived DTMs. They advertise the same styles as
    // the real lidar projects (skyggerelieff etc.) but render blank tiles
    // in this WMS. The "Bilde" ("image") prefix is Kartverket's naming
    // convention that distinguishes them from actual lidar acquisitions.
    if (/^Bilde\b/i.test(projectName)) continue;
    out.push({
      id: projectName,
      projectName,
      year: parseYear(projectName),
      pointDensity: parsePointDensity(projectName),
      bboxLonLat,
      styles: Array.from(styles).sort(),
    });
  }
  return out;
}

function readBboxFromLayerOrAncestor(
  layer: Element,
): [number, number, number, number] | null {
  // WMS 1.3.0 lets a child <Layer> inherit EX_GeographicBoundingBox from
  // its parent. Walk up the ancestor chain of <Layer> elements.
  let el: Element | null = layer;
  while (el && el.tagName === 'Layer') {
    const direct = Array.from(el.children).find(
      (c) => c.tagName === 'EX_GeographicBoundingBox',
    );
    if (direct) {
      const west = num(direct, 'westBoundLongitude');
      const east = num(direct, 'eastBoundLongitude');
      const south = num(direct, 'southBoundLatitude');
      const north = num(direct, 'northBoundLatitude');
      if ([west, east, south, north].every((v) => Number.isFinite(v))) {
        return [west, south, east, north];
      }
    }
    el = el.parentElement;
  }
  return null;
}

function num(parent: Element, tag: string): number {
  return parseFloat(parent.getElementsByTagName(tag)[0]?.textContent ?? 'NaN');
}

function unionBbox(
  bboxes: [number, number, number, number][],
): [number, number, number, number] | null {
  if (bboxes.length === 0) return null;
  let [minLon, minLat, maxLon, maxLat] = bboxes[0];
  for (let i = 1; i < bboxes.length; i++) {
    const b = bboxes[i];
    if (b[0] < minLon) minLon = b[0];
    if (b[1] < minLat) minLat = b[1];
    if (b[2] > maxLon) maxLon = b[2];
    if (b[3] > maxLat) maxLat = b[3];
  }
  return [minLon, minLat, maxLon, maxLat];
}

function parseYear(name: string): number | null {
  const m = name.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

function parsePointDensity(name: string): string | null {
  const m = name.match(/\b(\d+)\s*(pkt|pnt)\b/i);
  return m ? `${m[1]}${m[2].toLowerCase()}` : null;
}

function readCache(): LidarProject[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.projects;
  } catch {
    return null;
  }
}

function writeCache(projects: LidarProject[]) {
  try {
    const entry: CachedEntry = { ts: Date.now(), projects };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore quota / unavailable storage.
  }
}
