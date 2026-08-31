// Fetches real project boundary polygons from Kartverket's høydedata
// metadata WFS. Each acquisition ("prosjekt") is a MultiPolygon that
// follows actual county / hydrological / natural borders — far more
// truthful than the axis-aligned bounding boxes exposed by the DTM WMS
// GetCapabilities.
//
// CORS-open (`access-control-allow-origin: *`), so no wmscache proxying
// required. Response is GML 3.2 wrapped in a WFS FeatureCollection.
//
// We parse the DOM by hand instead of routing through OL's `ol/format/WFS`
// + `ol/format/GML32` because Kartverket wraps the geometry in a custom-
// named element (`metadata_prosjekt:SHAPE`). OL's parser expects the
// geometry to be a direct child of the feature element and silently drops
// it when wrapped, leaving features with no geometry and nothing on the
// map. The manual walk here handles the wrapper explicitly.

import { Feature } from 'ol';
import { MultiPolygon } from 'ol/geom';
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
  // Geometry stored in EPSG:25833 (WFS native); reproject on render.
  feature: Feature<MultiPolygon>;
};

// Cache of features by project id. Grows as the user pans over new areas
// with the overlay on. Not evicted — full national dataset is ~1933
// polygons, so unbounded growth is bounded in practice.
const cache = new Map<string, CoverageProject>();

export const fetchCoverageInBbox = async (
  bbox: [number, number, number, number],
  bboxProjection: string,
): Promise<Map<string, CoverageProject>> => {
  const bbox25833 =
    bboxProjection === SRS ? bbox : transformExtent(bbox, bboxProjection, SRS);

  // Kartverket's WFS silently ignores the bbox filter unless srsName is
  // passed as its own query parameter. Appending the CRS URI to the bbox
  // value (per the WFS spec: `bbox=x,y,x,y,urn:ogc:def:crs:EPSG::25833`)
  // returns 0 features every time. Same bbox with `srsName=EPSG:25833`
  // as a separate param returns the intersecting set. Verified against a
  // known-populated viewport (204039,6578284,221112,6590269): 0 → 16.
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
  if (!res.ok) {
    throw new Error(`WFS HTTP ${res.status}`);
  }
  const xml = await res.text();

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('WFS XML parse error');
  }

  const nodes = Array.from(
    doc.getElementsByTagNameNS('*', 'Prosjektavgrensning'),
  );
  for (const node of nodes) {
    const project = parseProject(node);
    if (project && !cache.has(project.id)) {
      cache.set(project.id, project);
    }
  }
  return cache;
};

const parseProject = (node: Element): CoverageProject | null => {
  const name = getFirstDescendantText(node, 'LAS_PROJECT_NAME');
  if (!name) return null;
  // Skip photogrammetry-derived DTMs. Kartverket ships them under the
  // same metadata service and they'd show up in the picker as if they
  // were real lidar acquisitions, but the DTM WMS renders blank tiles
  // for them. The "Bilde " ("image") prefix is Kartverket's naming
  // convention that separates them from actual laser scans.
  if (/^Bilde\b/i.test(name)) return null;
  const year = toFiniteNumber(getFirstDescendantText(node, 'AARSTALL'));
  const pointDensity = toFiniteNumber(
    getFirstDescendantText(node, 'PUNKTTETTHET'),
  );

  const multiSurface = firstDescendant(node, 'MultiSurface');
  if (!multiSurface) return null;
  const dim =
    parseInt(multiSurface.getAttribute('srsDimension') ?? '2', 10) || 2;
  const geometry = parseMultiSurface(multiSurface, dim);
  if (!geometry) return null;

  const feature = new Feature<MultiPolygon>({ geometry });
  return { id: name, projectName: name, year, pointDensity, feature };
};

type Coord = [number, number];
type Ring = Coord[];
type PolyCoords = Ring[];

const parseMultiSurface = (
  ms: Element,
  dim: number,
): MultiPolygon | null => {
  const polygons: PolyCoords[] = [];
  for (const sm of directChildrenByLocalName(ms, 'surfaceMember')) {
    const polyNode = firstDescendant(sm, 'Polygon');
    if (!polyNode) continue;
    const poly = parsePolygon(polyNode, dim);
    if (poly) polygons.push(poly);
  }
  return polygons.length > 0 ? new MultiPolygon(polygons) : null;
};

const parsePolygon = (node: Element, dim: number): PolyCoords | null => {
  const exterior = firstDescendant(node, 'exterior');
  if (!exterior) return null;
  const outer = parseLinearRing(exterior, dim);
  if (!outer) return null;
  const rings: Ring[] = [outer];
  for (const interior of directChildrenByLocalName(node, 'interior')) {
    const hole = parseLinearRing(interior, dim);
    if (hole) rings.push(hole);
  }
  return rings;
};

const parseLinearRing = (parent: Element, dim: number): Ring | null => {
  const posList = firstDescendant(parent, 'posList');
  if (!posList) return null;
  const raw = (posList.textContent ?? '').trim();
  if (!raw) return null;
  const nums = raw
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const pairs: Coord[] = [];
  for (let i = 0; i + 1 < nums.length; i += dim) {
    pairs.push([nums[i], nums[i + 1]]);
  }
  // A valid LinearRing is closed → ≥ 4 points.
  return pairs.length >= 4 ? pairs : null;
};

const getFirstDescendantText = (
  parent: Element,
  localName: string,
): string | null => {
  const els = parent.getElementsByTagNameNS('*', localName);
  return els.length > 0 ? (els[0].textContent?.trim() ?? null) : null;
};

const firstDescendant = (
  parent: Element,
  localName: string,
): Element | null => {
  const els = parent.getElementsByTagNameNS('*', localName);
  return els.length > 0 ? els[0] : null;
};

const directChildrenByLocalName = (
  parent: Element,
  localName: string,
): Element[] => {
  const out: Element[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i];
    if (c.localName === localName) out.push(c);
  }
  return out;
};

const toFiniteNumber = (s: string | null): number | null => {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
