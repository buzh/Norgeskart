import { getDefaultStore } from 'jotai';
import { Feature } from 'ol';
import { Color } from 'ol/color';
import { ColorLike, PatternDescriptor } from 'ol/colorlike';
import { GML } from 'ol/format';
import { Polygon } from 'ol/geom';
import { Fill, Stroke, Style } from 'ol/style';
import { getEnv } from '../env';
import { mapAtom } from '../map/atoms';

const BASE_API_URL = getEnv().apiUrl;

export type StyleForStorage = {
  fill: { color: Color | ColorLike | PatternDescriptor | null };
  stroke: {
    color: Color | ColorLike | undefined;
    width: number | undefined;
    lineDash?: number[];
  };
  text?: {
    text?: string | undefined; // Preferred/current format; 'value' is supported for backward compatibility
    value?: string | undefined;
    font: string | undefined;
    fillColor: Color | ColorLike | PatternDescriptor | null;
    backgroundFillColor: Color | ColorLike | PatternDescriptor | null;
    stroke?: {
      color: Color | ColorLike | undefined;
      width: number | undefined;
    };
  };
};

export const getPropertyGeometry = async (
  municipalityNumber: string, //kommunenummer
  holdingNumber: string, //gårdsnummer
  subHoldingNumber: string, //bruksnummer
  leaseNumber: string, //festenummer
  sectionNumber: string, //seksjonsnummer
) => {
  const id = `${municipalityNumber}-${holdingNumber}-${subHoldingNumber}-${leaseNumber}-${sectionNumber}`;
  const response = await fetch(`${BASE_API_URL}/v1/teiger/${id}/`);
  if (!response.ok) {
    console.error(
      `Failed to fetch property geometry for id ${id}: ${response.statusText}`,
    );
    return null;
  }
  const text = await response.text();

  const store = getDefaultStore();
  const projection = store.get(mapAtom).getView().getProjection().getCode();

  const gmlFormat = new GML({
    featureNS: 'http://www.statkart.no/matrikkel',
    featureType: ['TEIGWFS', 'ANLEGGSPFLATEWFS'],
    srsName: 'EPSG:4326',
  });
  const features = gmlFormat.readFeatures(text, {
    featureProjection: projection,
  });

  const style = new Style({
    stroke: new Stroke({ color: '#E54848FF', width: 2 }),
    fill: new Fill({ color: 'rgba(255, 255, 0, 0.25)' }),
  });

  return features
    .map((feature) => {
      return feature.get('FLATE') as Polygon;
    })
    .filter((geom) => geom != null)
    .map((geom) => {
      const feature = new Feature({ geometry: geom });
      feature.setStyle(style);
      return feature;
    });
};
