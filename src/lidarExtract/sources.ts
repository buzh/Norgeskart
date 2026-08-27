// Enumerates the LiDAR sources that overlap a chosen bbox: the national
// mosaic (wms.hoyde-dtm-nhm-topobathy-25833) plus every per-project layer
// from wms.hoyde-dtm-prosjekt whose declared bbox intersects the selection.
//
// Both WMS endpoints expose each style as its own named layer
// (e.g. `<prefix>:skyggerelieff`), so "styles" here really means the set of
// layer suffixes advertised in GetCapabilities under a given prefix.

import {
  fetchLidarProjects,
  LidarProject,
} from '../map/layers/config/backgroundLayers/lidarProjects';

export type LidarSource = {
  key: string;
  kind: 'national' | 'project';
  label: string;
  year: number | null;
  pointDensity: string | null;
  wmsUrl: string;
  layerPrefix: string; // 'NHM_DTM_TOPOBATHY_25833' or the project name
  styles: string[];
};

export const NATIONAL_WMS_URL =
  '/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833';
export const NATIONAL_LAYER_PREFIX = 'NHM_DTM_TOPOBATHY_25833';
export const PROJECT_WMS_URL = '/wms/geonorge/wms.hoyde-dtm-prosjekt';

const NATIONAL_CAPS_URL =
  `${NATIONAL_WMS_URL}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`;
// Bump when the parser filter changes so stale cached lists (e.g. still
// including the `None` pseudo-style) get discarded on next load.
const NATIONAL_STORAGE_KEY = 'lidarExtract.nationalStyles.v2';
const NATIONAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let nationalInflight: Promise<string[]> | null = null;

// Enumerate style suffixes advertised for the national DTM layer prefix.
// Falls back to the styles known to be published if the caps fetch fails.
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

// Kept as a floor so the UI still has something to offer when caps is down.
const NATIONAL_FALLBACK_STYLES = ['skyggerelieff'];

function parseStylesForPrefix(xmlText: string, prefix: string): string[] {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return [];
  const styles = new Set<string>();
  for (const layer of Array.from(doc.getElementsByTagName('Layer'))) {
    const name = layer.getElementsByTagName('Name')[0]?.textContent?.trim();
    if (!name || !name.startsWith(prefix + ':')) continue;
    const suffix = name.slice(prefix.length + 1);
    // Kartverket advertises a `<prefix>:None` pseudo-layer on the national
    // DTM WMS that renders as an unstyled near-uniform tile. It's not real
    // hillshade output — skip it.
    if (suffix === 'None') continue;
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

// Produce the sortable, filtered list of sources for a selection bbox given
// in EPSG:4326 (lon/lat). National mosaic is always first. Projects are
// filtered by bbox intersection and sorted newest / densest first.
export async function enumerateLidarSources(
  bboxLonLat: [number, number, number, number],
): Promise<LidarSource[]> {
  const [projects, nationalStyles] = await Promise.all([
    fetchLidarProjects(),
    fetchNationalLidarStyles(),
  ]);

  const national: LidarSource = {
    key: 'national',
    kind: 'national',
    label: 'Nasjonal mosaikk',
    year: null,
    pointDensity: null,
    wmsUrl: NATIONAL_WMS_URL,
    layerPrefix: NATIONAL_LAYER_PREFIX,
    styles: nationalStyles,
  };

  const overlapping = projects
    .filter((p) => bboxIntersects(p.bboxLonLat, bboxLonLat))
    .sort(byRecency)
    .map(projectToSource);

  return [national, ...overlapping];
}

function projectToSource(p: LidarProject): LidarSource {
  return {
    key: `project:${p.projectName}`,
    kind: 'project',
    label: p.projectName,
    year: p.year,
    pointDensity: p.pointDensity,
    wmsUrl: PROJECT_WMS_URL,
    layerPrefix: p.projectName,
    styles: p.styles,
  };
}

function bboxIntersects(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function byRecency(a: LidarProject, b: LidarProject): number {
  const ay = a.year ?? -Infinity;
  const by = b.year ?? -Infinity;
  if (ay !== by) return by - ay;
  const ad = densityOrder(a.pointDensity);
  const bd = densityOrder(b.pointDensity);
  if (ad !== bd) return bd - ad;
  return a.projectName.localeCompare(b.projectName);
}

function densityOrder(d: string | null): number {
  if (!d) return 0;
  const m = d.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// Best-guess native ground resolution per source, used to pick a
// sensible default when the user hasn't overridden it. Higher point
// density → finer native resolution. National mosaic is 1 m.
export function nativeResolutionMetersPerPx(source: LidarSource): number {
  if (source.kind === 'national') return 1;
  const d = source.pointDensity;
  if (!d) return 0.5;
  const m = d.match(/^(\d+)/);
  const pts = m ? parseInt(m[1], 10) : 0;
  if (pts >= 20) return 0.15;
  if (pts >= 10) return 0.2;
  if (pts >= 5) return 0.3;
  if (pts >= 2) return 0.5;
  return 1;
}
