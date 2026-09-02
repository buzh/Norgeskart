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
const STORAGE_KEY = 'lidarProjects.v4';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The project the picker most recently activated as the background source.
// Read by the background-layer effect when backgroundLayerAtom is
// 'lidarProject' to build the actual WMS request.
export const activeLidarProjectAtom = atom<LidarProject | null>(null);

// The styled variant (skyggerelieff, multiskyggerelieff, ...) currently
// shown for whichever dataset is active (national mosaic or a project).
// Read by the background-layer effect alongside activeLidarProjectAtom.
export const activeLidarStyleAtom = atom<string>('skyggerelieff');

export const LIDAR_PROJECT_WMS_URL = '/wms/geonorge/wms.hoyde-dtm-prosjekt';
export const DEFAULT_LIDAR_PROJECT_STYLE = 'skyggerelieff';

// The three most diagnostic variants for reading archaeology in terrain —
// shown first, in this order, in the style pulldown. Anything else
// (helning_grader and whatever else a dataset happens to publish) sits
// behind that pulldown's "flere lag" overflow.
export const TIER_A_STYLES = [
  'skyggerelieff',
  'multiskyggerelieff',
  'helning_prosent',
];

// Styles that are advertised but not useful to show anywhere:
//   - `None`: the "no style" placeholder (renders a near-uniform PNG).
//   - `dynamisk_farget_hoyde`: Kartverket picks a per-tile colour ramp
//     from the local elevation range, so adjacent tiles get incompatible
//     palettes — looks broken as a background layer.
const EXCLUDED_STYLES = new Set<string>(['None', 'dynamisk_farget_hoyde']);

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
      styles: Array.from(styles)
        .filter((s) => !EXCLUDED_STYLES.has(s))
        .sort(),
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

// pointDensity is a string like "10pkt" — parse the leading digits so we
// can sort/compare densest first. Shared by the TopBar picker and the
// footprint-layer relevance classification.
export const densityOrder = (d: string | null): number => {
  if (!d) return 0;
  const m = d.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

// Newest first, then densest, then alphabetical — the display order for
// every LiDAR project list in the app.
export const sortProjectsByRelevance = (
  a: LidarProject,
  b: LidarProject,
): number => {
  const ay = a.year ?? -Infinity;
  const by = b.year ?? -Infinity;
  if (ay !== by) return by - ay;
  const ad = densityOrder(a.pointDensity);
  const bd = densityOrder(b.pointDensity);
  if (ad !== bd) return bd - ad;
  return a.projectName.localeCompare(b.projectName);
};

export const bboxIntersects = (
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

// --- National mosaic styles ---
//
// wms.hoyde-dtm-nhm-topobathy-25833 publishes the same kind of styled
// variants as the per-project WMS, under one fixed layer prefix instead
// of one per acquisition. Moved here (from lidarExtract/sources.ts, which
// re-exports it) so the TopBar style pulldown and the LiDAR-uttrekk tool
// share one fetch/cache instead of hitting GetCapabilities twice.

export const NATIONAL_WMS_URL =
  '/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833';
export const NATIONAL_LAYER_PREFIX = 'NHM_DTM_TOPOBATHY_25833';

const NATIONAL_CAPS_URL =
  `${NATIONAL_WMS_URL}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`;
// Bump when the parser filter changes so stale cached lists (e.g. still
// including the `None` pseudo-style) get discarded on next load.
const NATIONAL_STORAGE_KEY = 'lidarProjects.nationalStyles.v1';
const NATIONAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Kept as a floor so the UI still has something to offer when caps is down.
const NATIONAL_FALLBACK_STYLES = [DEFAULT_LIDAR_PROJECT_STYLE];

let nationalInflight: Promise<string[]> | null = null;

export function fetchNationalLidarStyles(): Promise<string[]> {
  if (nationalInflight) return nationalInflight;
  const cached = readNationalCache();
  if (cached) return Promise.resolve(cached);
  nationalInflight = (async () => {
    try {
      const res = await fetch(NATIONAL_CAPS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const styles = parseStylesForPrefix(xml, NATIONAL_LAYER_PREFIX);
      const out = styles.length > 0 ? styles : NATIONAL_FALLBACK_STYLES;
      writeNationalCache(out);
      return out;
    } catch {
      return NATIONAL_FALLBACK_STYLES;
    }
  })().finally(() => {
    nationalInflight = null;
  });
  return nationalInflight;
}

function parseStylesForPrefix(xmlText: string, prefix: string): string[] {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return [];
  const styles = new Set<string>();
  for (const layer of Array.from(doc.getElementsByTagName('Layer'))) {
    const name = layer.getElementsByTagName('Name')[0]?.textContent?.trim();
    if (!name || !name.startsWith(prefix + ':')) continue;
    const suffix = name.slice(prefix.length + 1);
    if (EXCLUDED_STYLES.has(suffix)) continue;
    styles.add(suffix);
  }
  return Array.from(styles).sort();
}

function readNationalCache(): string[] | null {
  try {
    const raw = localStorage.getItem(NATIONAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; styles: string[] };
    if (Date.now() - parsed.ts > NATIONAL_TTL_MS) return null;
    return parsed.styles;
  } catch {
    return null;
  }
}

function writeNationalCache(styles: string[]) {
  try {
    localStorage.setItem(
      NATIONAL_STORAGE_KEY,
      JSON.stringify({ ts: Date.now(), styles }),
    );
  } catch {
    /* quota / unavailable */
  }
}
