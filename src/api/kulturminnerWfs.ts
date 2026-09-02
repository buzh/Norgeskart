// "Kjente kulturminner i området" — queries Kartverket's kulturminner
// WFS (GeoNorge redistribution of the Askeladden lokalitet layer) for
// everything inside a bbox. Routed same-origin through wmscache
// (/wfs/geonorge/ → wfs.geonorge.no/skwms1/, uncached).
//
// Note: kart.ra.no itself has WFS disabled (checked 2026-09), which is
// why this goes to GeoNorge instead. Only GML 3.2 output is offered, so
// we DOMParse the handful of fields the readout shows rather than
// pulling in a full GML parser.

const WFS_URL = '/wfs/geonorge/wfs.kulturminner';

export type KnownKulturminne = {
  navn: string;
  // Raw register codes; the UI maps the common ones to labels.
  kategori: string; // lokalitetskategori, e.g. L-ARK / L-BVF / L-KRK
  vernetype: string; // e.g. AUT / VED / LIST / UAV
  antallEnkeltminner: number | null;
  linkKulturminnesok: string | null;
};

export type KulturminnerResult = {
  items: KnownKulturminne[];
  // true when the COUNT cap was hit — there may be more than shown.
  truncated: boolean;
};

const MAX_COUNT = 100;

const childText = (el: Element, localName: string): string | null => {
  const hits = el.getElementsByTagNameNS('*', localName);
  return hits.length > 0 ? (hits[0].textContent?.trim() ?? null) : null;
};

export const fetchKulturminnerInBbox = async (
  bbox25833: [number, number, number, number],
): Promise<KulturminnerResult> => {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'app:Lokalitet',
    COUNT: String(MAX_COUNT),
    SRSNAME: 'urn:ogc:def:crs:EPSG::25833',
    BBOX: `${bbox25833.join(',')},urn:ogc:def:crs:EPSG::25833`,
  });
  const res = await fetch(`${WFS_URL}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`kulturminner WFS returned ${res.status}`);
  }
  const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
  if (doc.getElementsByTagNameNS('*', 'ExceptionReport').length > 0) {
    throw new Error('kulturminner WFS returned an exception report');
  }

  const items: KnownKulturminne[] = [];
  const allLokalitet = Array.from(doc.getElementsByTagNameNS('*', 'Lokalitet'));
  // Real features carry a gml:id; anything else with the same local name
  // is a nested property group.
  const feats = allLokalitet.filter((el) => el.getAttribute('gml:id'));
  for (const el of feats) {
    const antall = childText(el, 'antallEnkeltminner');
    items.push({
      navn: childText(el, 'navn') ?? '',
      kategori: childText(el, 'lokalitetskategori') ?? '',
      vernetype: childText(el, 'vernetype') ?? '',
      antallEnkeltminner: antall != null ? Number(antall) : null,
      linkKulturminnesok: childText(el, 'linkKulturminnesøk'),
    });
  }
  return { items, truncated: feats.length >= MAX_COUNT };
};
