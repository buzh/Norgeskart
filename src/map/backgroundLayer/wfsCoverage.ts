// Fetches real project boundary polygons from Kartverket's WFS. Each
// acquisition ("prosjekt") is a MultiPolygon that follows actual county /
// hydrological / natural borders — far more truthful than the axis-aligned
// bounding boxes exposed by the DTM WMS GetCapabilities.
//
// CORS-open (`access-control-allow-origin: *`), so no wmscache proxying
// required. Response is GML 3.2, parsed with OL's WFS format.

import { Feature } from 'ol';
import GML32 from 'ol/format/GML32';
import WFS from 'ol/format/WFS';
import { Geometry } from 'ol/geom';
import { transformExtent } from 'ol/proj';

const WFS_URL =
  'https://wfs.geonorge.no/skwms1/wfs.hoyde-hoydedata-metadata-prosjekt';
const TYPE_NAME = 'metadata_prosjekt:Prosjektavgrensning';
const SRS = 'EPSG:25833';
const SRS_URI = 'urn:ogc:def:crs:EPSG::25833';

export type CoverageProject = {
  // Matches the WMS layer-name prefix in wms.hoyde-dtm-prosjekt (Kartverket
  // shares the project registry across the two services).
  id: string;
  projectName: string;
  year: number | null;
  pointDensity: number | null; // pt/m²
  // Geometry is stored in EPSG:25833 (WFS native) so subsequent map-view
  // rebuilds can transform without re-fetching.
  feature: Feature<Geometry>;
};

// Cache of features by project id. Grows as the user pans over new areas.
// Not evicted — the whole national dataset is ~1933 polygons, so unbounded
// growth is bounded in practice.
const cache = new Map<string, CoverageProject>();

// Fetches project polygons intersecting the given bbox and merges them into
// the module cache. Returns the full cache (as of this call) so callers can
// re-render with everything they've seen so far.
//
// `bbox` is in `bboxProjection`; we reproject it into the WFS-native SRS
// before sending, then request features in that SRS and reproject on the
// consumer side.
export const fetchCoverageInBbox = async (
  bbox: [number, number, number, number],
  bboxProjection: string,
): Promise<Map<string, CoverageProject>> => {
  const bbox25833 =
    bboxProjection === SRS ? bbox : transformExtent(bbox, bboxProjection, SRS);

  const url = new URL(WFS_URL);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('typeNames', TYPE_NAME);
  url.searchParams.set('srsName', SRS);
  url.searchParams.set(
    'bbox',
    `${bbox25833[0]},${bbox25833[1]},${bbox25833[2]},${bbox25833[3]},${SRS_URI}`,
  );

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`WFS HTTP ${res.status}`);
  const xml = await res.text();

  const parser = new WFS({ gmlFormat: new GML32() });
  const features = parser.readFeatures(xml, {
    dataProjection: SRS,
    featureProjection: SRS,
  }) as Feature<Geometry>[];

  for (const f of features) {
    const project = toCoverageProject(f);
    if (project && !cache.has(project.id)) {
      cache.set(project.id, project);
    }
  }
  return cache;
};

const toCoverageProject = (
  f: Feature<Geometry>,
): CoverageProject | null => {
  const name = f.get('LAS_PROJECT_NAME');
  if (!name || typeof name !== 'string') return null;
  const yearRaw = f.get('AARSTALL');
  const densityRaw = f.get('PUNKTTETTHET');
  const year =
    typeof yearRaw === 'number'
      ? yearRaw
      : yearRaw != null && !Number.isNaN(Number(yearRaw))
        ? Number(yearRaw)
        : null;
  const pointDensity =
    typeof densityRaw === 'number'
      ? densityRaw
      : densityRaw != null && !Number.isNaN(Number(densityRaw))
        ? Number(densityRaw)
        : null;
  return { id: name, projectName: name, year, pointDensity, feature: f };
};
