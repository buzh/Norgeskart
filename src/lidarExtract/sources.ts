// Enumerates the LiDAR sources that overlap a chosen bbox: the national
// mosaic (wms.hoyde-dtm-nhm-topobathy-25833) plus every per-project layer
// from wms.hoyde-dtm-prosjekt whose declared bbox intersects the selection.
//
// Both WMS endpoints expose each style as its own named layer
// (e.g. `<prefix>:skyggerelieff`), so "styles" here really means the set of
// layer suffixes advertised in GetCapabilities under a given prefix.

import {
  bboxIntersects,
  fetchLidarProjects,
  fetchNationalLidarStyles,
  LidarProject,
  NATIONAL_LAYER_PREFIX,
  NATIONAL_WMS_URL,
  sortProjectsByRelevance,
} from '../map/layers/config/backgroundLayers/lidarProjects';

export { fetchNationalLidarStyles };

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

export const PROJECT_WMS_URL = '/wms/geonorge/wms.hoyde-dtm-prosjekt';

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
    .sort(sortProjectsByRelevance)
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
