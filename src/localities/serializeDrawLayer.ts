import type { FeatureCollection } from 'geojson';
import { GeoJSON } from 'ol/format';
import { Circle as CircleGeom } from 'ol/geom';
import { fromCircle } from 'ol/geom/Polygon';
import { getDrawLayer } from '../draw/drawControls/hooks/mapLayers';
import { getFeaturePropertiesForExport } from '../draw/utils/featureUtils';

// Serialize everything currently on the shared draw layer to a GeoJSON
// FeatureCollection in EPSG:4326, style properties included so the funn
// layer can re-render each feature exactly as drawn.
//
// Circle is a valid OL geometry but NOT a GeoJSON one — writeFeatures
// throws on it, which used to lose the entire save silently. Convert to
// a 64-sided polygon before serializing; keeps a radius prop so an
// editor could reconstruct the circle later.
export const serializeDrawLayer = (
  mapProjection: string,
): FeatureCollection | null => {
  const layer = getDrawLayer();
  const features = layer?.getSource()?.getFeatures() ?? [];
  if (features.length === 0) return null;

  const cloned = features.map((f) => {
    const clone = f.clone();
    clone.setId(f.getId());
    const props = getFeaturePropertiesForExport(f);
    if (props) clone.setProperties(props, true);
    const geom = clone.getGeometry();
    if (geom instanceof CircleGeom) {
      clone.set('radius', geom.getRadius(), true);
      clone.setGeometry(fromCircle(geom, 64));
    }
    return clone;
  });

  let geoJsonString: string;
  try {
    geoJsonString = new GeoJSON().writeFeatures(cloned, {
      dataProjection: 'EPSG:4326',
      featureProjection: mapProjection,
    });
  } catch (e) {
    console.warn('[serializeDrawLayer] writeFeatures threw', e, cloned);
    return null;
  }
  return JSON.parse(geoJsonString) as FeatureCollection;
};
