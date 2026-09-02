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

import GeoJSON from 'ol/format/GeoJSON';
import { Geometry } from 'ol/geom';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import { getArea } from 'ol/sphere';
import { LidarProject } from './lidarProjects';

const WFS_URL = '/wfs/geonorge/wfs.hoyde-hoydedata-metadata-prosjekt';
const TYPE_NAME = 'metadata_prosjekt:Prosjektavgrensning';

export type LidarFootprint = {
  project: LidarProject;
  // A project can appear as several disjoint WFS features (sub-areas);
  // keep every part rather than merging geometry.
  geometries: Geometry[];
  areaM2: number;
};

// The WFS's LAS_PROJECT_NAME doesn't carry the point-density token that
// wms.hoyde-dtm-prosjekt's layer names do (e.g. "Flatanger 2013" vs
// "Flatanger 10pkt 2013") — strip it so both sides normalize the same.
const normalize = (name: string): string =>
  name
    .toLowerCase()
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

// Session-lived cache keyed by a coarse bucket of the requested extent —
// re-opening the picker at a similar view shouldn't re-fetch. No TTL:
// project boundaries are static for the lifetime of a tab.
const BUCKET_METRES = 2000;
const cache = new Map<string, Promise<Map<string, LidarFootprint>>>();

const bucketKey = (extent: [number, number, number, number]): string =>
  extent.map((v) => Math.round(v / BUCKET_METRES)).join(':');

// Fetches every project boundary intersecting `extent` (in `projection`),
// matches each one against `projects` (the wms.hoyde-dtm-prosjekt
// catalogue) by normalized name — disambiguating same-name candidates by
// year within ±2 — and returns a map keyed by LidarProject.id. Projects
// with no WFS match are simply absent from the result.
export function fetchLidarFootprints(
  extent: [number, number, number, number],
  projection: string,
  projects: LidarProject[],
): Promise<Map<string, LidarFootprint>> {
  const key = bucketKey(extent);
  const cached = cache.get(key);
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
      BBOX: urn ? `${extent.join(',')},${urn}` : extent.join(','),
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

    // Index the catalogue by normalized name, keeping every candidate so
    // same-name matches can be disambiguated by year.
    const byName = new Map<string, LidarProject[]>();
    for (const p of projects) {
      const bucket = byName.get(normalize(p.projectName)) ?? [];
      bucket.push(p);
      byName.set(normalize(p.projectName), bucket);
    }

    const out = new Map<string, LidarFootprint>();
    for (const feature of features) {
      const props = feature.getProperties() as WfsProperties;
      if (!props.LAS_PROJECT_NAME) continue;
      const candidates = byName.get(normalize(props.LAS_PROJECT_NAME));
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
      const areaM2 =
        (existing?.areaM2 ?? 0) + getArea(geometry, { projection });
      out.set(match.id, {
        project: match,
        geometries: [...(existing?.geometries ?? []), geometry],
        areaM2,
      });
    }
    return out;
  })();

  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

// Rough area estimate for the rare project with no WFS match, used only
// to feed the size-relevance rule — not drawn on the map.
export const bboxAreaEstimateM2 = (
  bboxLonLat: [number, number, number, number],
): number =>
  getArea(polygonFromExtent(bboxLonLat), { projection: 'EPSG:4326' });
