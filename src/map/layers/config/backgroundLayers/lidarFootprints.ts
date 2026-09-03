// Real per-project LiDAR coverage footprints — Kartverket's
// "Prosjektavgrensning" (project boundary) WFS, the same service that
// backs høydedata.no's project map. A full-catalogue join against
// wms.hoyde-dtm-prosjekt (see docs/plan history) confirmed ~100% of
// projects match by normalized name + year tolerance, so this is now the
// sole source of truth for "does this project actually cover the
// viewport" — real polygon-vs-viewport intersection replaces the old
// center-point pixel probe (coverageProbe.ts, removed).
//
// Routed same-origin through wmscache (/wfs/geonorge/ →
// wfs.geonorge.no/skwms1/, uncached — same path shape as
// api/kulturminnerWfs.ts).
//
// Responses are large and neither cached nor compressed on the way here
// (~1 MB for a 20 km viewport, 7.7 MB for a county, ~18 MB for a zoom-7
// screenful), so callers must bound how far out they ask — see
// MIN_FOOTPRINT_ZOOM in map/lidarFootprintsLayer.ts.

import GeoJSON from 'ol/format/GeoJSON';
import { Geometry } from 'ol/geom';
import { LidarProject } from './lidarProjects';

const WFS_URL = '/wfs/geonorge/wfs.hoyde-hoydedata-metadata-prosjekt';
const TYPE_NAME = 'metadata_prosjekt:Prosjektavgrensning';

export type LidarFootprint = {
  project: LidarProject;
  // A project can appear as several disjoint WFS features (sub-areas);
  // keep every part rather than merging geometry.
  geometries: Geometry[];
};

// Both catalogues normally spell a project identically, point-density
// token included ("Selbu 5pkt 2007" on either side), so the full name is
// the primary key. Stripping that token up front is what breaks: 81 name
// groups in the WMS catalogue (169 of 1934 projects) differ by nothing
// else — Selbu 2pkt / 024pkt / 5pkt 2007, Gjerdrum 5pkt / 50pkt 2021 —
// and all their sibling footprints would collapse onto whichever
// candidate matched first, leaving the rest undrawn.
const normalizeName = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, ' ').trim();

// Fallback key for the rare one-sided spelling, tried only when the full
// name finds nothing.
const stripDensity = (normalized: string): string =>
  normalized
    .replace(/\b\d+\s*(pkt|pnt)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const YEAR_TOLERANCE = 2;

type WfsProperties = {
  LAS_PROJECT_NAME?: string;
  AARSTALL?: number | string;
};

const crsUrn = (projection: string): string | undefined => {
  const m = projection.match(/EPSG:(\d+)/i);
  return m ? `urn:ogc:def:crs:EPSG::${m[1]}` : undefined;
};

// A GeoJSON FeatureCollection's optional legacy `crs` member — ArcGIS-
// backed WFS servers (this one included) set it when the output isn't
// plain WGS84, which lets us interpret coordinates correctly regardless
// of whether the server actually honored our SRSNAME request.
const epsgFromCrsMember = (doc: unknown): string | undefined => {
  const name = (
    doc as { crs?: { properties?: { name?: string } } }
  )?.crs?.properties?.name;
  if (!name) return undefined;
  const m = name.match(/EPSG[:.]{1,2}(\d+)/i);
  return m ? `EPSG:${m[1]}` : undefined;
};

// Session-lived cache keyed by the requested extent, quantized so that
// panning a little re-uses the previous response. No TTL — project
// boundaries are static for the lifetime of a tab — so what bounds it is
// size instead, see MAX_CACHE_ENTRIES below.
//
// How much the map may move before the answer is refetched, as a
// fraction of the viewport's longer side. A fixed distance (this was
// 2 km) means the tolerance shrinks in screen terms the further you zoom
// out: 2 km is ~90 px of a 30 km viewport but ~12 px of a 240 km one, so
// out at MIN_FOOTPRINT_ZOOM every nudge refetched a response that
// overlapped the last one almost entirely.
const BUCKET_FRACTION = 0.05;

// Two views can only share a key if they land on the same grid, so the
// step can't be a raw fraction of the extent — a window resize, or the
// browser's own rounding of the map size, would slide the grid and miss
// every time. Snapping it to a power of two keeps it stable across
// anything short of a zoom step, which busts the cache regardless.
const bucketSize = (extent: [number, number, number, number]): number => {
  const span = Math.max(extent[2] - extent[0], extent[3] - extent[1]);
  return 2 ** Math.round(Math.log2(span * BUCKET_FRACTION));
};

// The extent we actually ask the WFS about: the viewport rounded
// *outward* to the grid. Rounding to nearest would key a response by an
// area it doesn't cover, and reusing it for a view shifted half a bucket
// would silently drop the footprints along the new edge. Overshooting
// costs one bucket per side — ~20% more payload — and the extra
// features off-screen are dropped anyway, since callers filter against
// the true viewport extent (touchesExtent / viewportCoverage).
const snapExtent = (
  extent: [number, number, number, number],
): [number, number, number, number] => {
  const step = bucketSize(extent);
  return [
    Math.floor(extent[0] / step) * step,
    Math.floor(extent[1] / step) * step,
    Math.ceil(extent[2] / step) * step,
    Math.ceil(extent[3] / step) * step,
  ];
};

const cache = new Map<string, Promise<Map<string, LidarFootprint>>>();

// How many responses to keep. An entry is a whole screenful of parsed
// boundary geometry — a couple of hundred projects out at
// MIN_FOOTPRINT_ZOOM — so this is a memory bound first and a hit-rate
// knob second: enough for panning back and forth around one area and
// stepping a zoom level or two, not for a session's worth of browsing.
const MAX_CACHE_ENTRIES = 8;

// Map iterates in insertion order, so re-inserting on read is what makes
// the eviction below least-*recently-used* rather than oldest-first.
const readCache = (
  key: string,
): Promise<Map<string, LidarFootprint>> | undefined => {
  const hit = cache.get(key);
  if (!hit) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
};

const writeCache = (
  key: string,
  value: Promise<Map<string, LidarFootprint>>,
) => {
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
};

// Fetches every project boundary intersecting `extent` (in `projection`)
// — or a little beyond it, see snapExtent — then
// matches each one against `projects` (the wms.hoyde-dtm-prosjekt
// catalogue) by normalized name — disambiguating same-name candidates by
// year within ±2 — and returns a map keyed by LidarProject.id. Projects
// with no WFS match are simply absent from the result.
export function fetchLidarFootprints(
  extent: [number, number, number, number],
  projection: string,
  projects: LidarProject[],
): Promise<Map<string, LidarFootprint>> {
  const fetchExtent = snapExtent(extent);
  // Projection in the key too: the same numbers name different ground in
  // EPSG:25833 and 25835.
  const key = `${projection}|${fetchExtent.join(':')}`;
  const cached = readCache(key);
  if (cached) return cached;

  const promise = (async () => {
    const urn = crsUrn(projection);
    const params = new URLSearchParams({
      SERVICE: 'WFS',
      VERSION: '2.0.0',
      REQUEST: 'GetFeature',
      TYPENAMES: TYPE_NAME,
      OUTPUTFORMAT: 'geojson',
      COUNT: '500',
      BBOX: urn ? `${fetchExtent.join(',')},${urn}` : fetchExtent.join(','),
      ...(urn ? { SRSNAME: urn } : {}),
    });
    const res = await fetch(`${WFS_URL}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Prosjektavgrensning WFS returned ${res.status}`);
    }
    const json = await res.json();

    const dataProjection = epsgFromCrsMember(json) ?? projection;
    const features = new GeoJSON().readFeatures(json, {
      dataProjection,
      featureProjection: projection,
    });

    // Index the catalogue under both keys, keeping every candidate so
    // same-name matches can be disambiguated by year.
    const byExactName = new Map<string, LidarProject[]>();
    const byStrippedName = new Map<string, LidarProject[]>();
    const index = (
      map: Map<string, LidarProject[]>,
      key: string,
      p: LidarProject,
    ) => {
      const bucket = map.get(key) ?? [];
      bucket.push(p);
      map.set(key, bucket);
    };
    for (const p of projects) {
      const exact = normalizeName(p.projectName);
      index(byExactName, exact, p);
      index(byStrippedName, stripDensity(exact), p);
    }

    const out = new Map<string, LidarFootprint>();
    for (const feature of features) {
      const props = feature.getProperties() as WfsProperties;
      if (!props.LAS_PROJECT_NAME) continue;
      const exact = normalizeName(props.LAS_PROJECT_NAME);
      const candidates =
        byExactName.get(exact) ?? byStrippedName.get(stripDensity(exact));
      if (!candidates || candidates.length === 0) continue;
      const wfsYear =
        props.AARSTALL != null ? Number(props.AARSTALL) : null;
      const match =
        candidates.length === 1
          ? candidates[0]
          : candidates.find(
              (c) =>
                c.year != null &&
                wfsYear != null &&
                Math.abs(c.year - wfsYear) <= YEAR_TOLERANCE,
            );
      if (!match) continue;
      const geometry = feature.getGeometry();
      if (!geometry) continue;

      const existing = out.get(match.id);
      out.set(match.id, {
        project: match,
        geometries: [...(existing?.geometries ?? []), geometry],
      });
    }
    return out;
  })();

  writeCache(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

// How much of the viewport a project's footprint actually paints, 0..1.
//
// Sampled on a grid rather than clipped analytically: OL has no polygon
// intersection, and a topology library is a lot of bytes for a number
// that only orders a list. A 24×24 grid resolves under 0.2% of the
// screen — far finer than either the ordering or the "minste andel av
// synsfeltet" filter can act on.
//
// `extent` and `geometries` must be in the same (projected, metric)
// coordinate system, which they are: readFeatures reprojects to the
// view's projection.
const COVERAGE_GRID = 24;

export const viewportCoverage = (
  geometries: Geometry[],
  extent: [number, number, number, number],
): number => {
  if (geometries.length === 0) return 0;
  const cellW = (extent[2] - extent[0]) / COVERAGE_GRID;
  const cellH = (extent[3] - extent[1]) / COVERAGE_GRID;
  if (cellW <= 0 || cellH <= 0) return 0;

  // Boundary polygons run to thousands of vertices, and the sample can't
  // see detail finer than a cell anyway. getSimplifiedGeometry takes a
  // *squared* tolerance.
  const tolerance = Math.min(cellW, cellH);
  const simplified = geometries.map((g) =>
    g.getSimplifiedGeometry(tolerance * tolerance),
  );

  let hits = 0;
  for (let ix = 0; ix < COVERAGE_GRID; ix++) {
    const x = extent[0] + (ix + 0.5) * cellW;
    for (let iy = 0; iy < COVERAGE_GRID; iy++) {
      const y = extent[1] + (iy + 0.5) * cellH;
      if (simplified.some((g) => g.intersectsCoordinate([x, y]))) hits++;
    }
  }
  return hits / (COVERAGE_GRID * COVERAGE_GRID);
};

// Whether any part of the footprint falls inside the viewport at all.
// Cheaper and stricter than the coverage sample: a project that clips a
// corner still belongs in the list (bottom of it), but one the WFS
// returned only because its envelope overlaps does not.
export const touchesExtent = (
  geometries: Geometry[],
  extent: [number, number, number, number],
): boolean => geometries.some((g) => g.intersectsExtent(extent));
