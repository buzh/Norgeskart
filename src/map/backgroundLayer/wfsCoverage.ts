// Lists Kartverket LiDAR/DTM acquisition projects covering a bbox, via
// the høydedata metadata WFS. Used by the TopBar's LiDAR pulldown to show
// which datasets are available in the current viewport.
//
// CORS-open (`access-control-allow-origin: *`), so no wmscache proxying.
// Response is GML 3.2 wrapped in a WFS FeatureCollection. We only need
// the metadata fields (name, year, density) — geometry is discarded.

import { transformExtent } from 'ol/proj';

const WFS_URL =
  'https://wfs.geonorge.no/skwms1/wfs.hoyde-hoydedata-metadata-prosjekt';
const TYPE_NAME = 'metadata_prosjekt:Prosjektavgrensning';
const SRS = 'EPSG:25833';

export type CoverageProject = {
  // Matches the WMS layer-name prefix in wms.hoyde-dtm-prosjekt (Kartverket
  // shares the project registry across the two services).
  id: string;
  projectName: string;
  year: number | null;
  pointDensity: number | null; // pt/m²
};

// Returns projects intersecting the viewport bbox. No caching — the
// pulldown fetches on open, and WFS response for a viewport is small
// enough that a fresh request per open is fine.
export const fetchCoverageInBbox = async (
  bbox: [number, number, number, number],
  bboxProjection: string,
): Promise<CoverageProject[]> => {
  const bbox25833 =
    bboxProjection === SRS ? bbox : transformExtent(bbox, bboxProjection, SRS);

  // Literal query string: URLSearchParams percent-encodes the `:` in the
  // CRS URI, which Kartverket's WFS silently rejects. Also, the WFS
  // requires srsName as its own param rather than appended to bbox.
  const bboxParam = `${bbox25833[0]},${bbox25833[1]},${bbox25833[2]},${bbox25833[3]}`;
  const query = [
    'service=WFS',
    'version=2.0.0',
    'request=GetFeature',
    `typeNames=${TYPE_NAME}`,
    `bbox=${bboxParam}`,
    `srsName=${SRS}`,
  ].join('&');

  const res = await fetch(`${WFS_URL}?${query}`);
  if (!res.ok) throw new Error(`WFS HTTP ${res.status}`);
  const xml = await res.text();

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('WFS XML parse error');
  }

  const nodes = Array.from(
    doc.getElementsByTagNameNS('*', 'Prosjektavgrensning'),
  );
  const projects: CoverageProject[] = [];
  for (const node of nodes) {
    const project = parseProject(node);
    if (project) projects.push(project);
  }
  return projects;
};

const parseProject = (node: Element): CoverageProject | null => {
  const name = getFirstDescendantText(node, 'LAS_PROJECT_NAME');
  if (!name) return null;
  // Skip photogrammetry-derived DTMs. Kartverket ships them in the same
  // metadata service under the "Bilde " prefix, but the DTM WMS renders
  // blank tiles for them.
  if (/^Bilde\b/i.test(name)) return null;
  const year = toFiniteNumber(getFirstDescendantText(node, 'AARSTALL'));
  const pointDensity = toFiniteNumber(
    getFirstDescendantText(node, 'PUNKTTETTHET'),
  );
  return { id: name, projectName: name, year, pointDensity };
};

const getFirstDescendantText = (
  parent: Element,
  localName: string,
): string | null => {
  const els = parent.getElementsByTagNameNS('*', localName);
  return els.length > 0 ? (els[0].textContent?.trim() ?? null) : null;
};

const toFiniteNumber = (s: string | null): number | null => {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
