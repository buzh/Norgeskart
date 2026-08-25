import { Box, Button, HStack, Text, VStack } from '@kvib/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useEffect, useRef, useState } from 'react';
import { mapAtom } from '../atoms';
import { backgroundLayerAtom } from '../layers/config/backgroundLayers/atoms';
import {
  activeLidarProjectAtom,
  fetchLidarProjects,
  LidarProject,
  lidarProjectTileStatsAtom,
} from '../layers/config/backgroundLayers/lidarProjects';
import { probeCoverage, readCoverage } from './coverageProbe';
import { warmLidarProjectTiles } from './prefetchWarmer';

export const SourcePicker = () => {
  const map = useAtomValue(mapAtom);
  const backgroundLayer = useAtomValue(backgroundLayerAtom);
  const activeLidarProject = useAtomValue(activeLidarProjectAtom);
  const setBackgroundLayer = useSetAtom(backgroundLayerAtom);
  const setActiveLidarProject = useSetAtom(activeLidarProjectAtom);
  const tileStats = useAtomValue(lidarProjectTileStatsAtom);

  const [projects, setProjects] = useState<LidarProject[]>([]);
  const [viewState, setViewState] = useState<{
    extentLonLat: [number, number, number, number];
    extent: [number, number, number, number];
    center: [number, number];
    resolution: number;
    zoom: number;
    projection: string;
  } | null>(null);
  // Bumped every time a coverage probe resolves; the setState alone
  // triggers a re-render that re-reads the probe cache. The value itself
  // is never read.
  const [, setProbeVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchLidarProjects()
      .then((p) => {
        if (!cancelled) setProjects(p);
      })
      .catch((err) => console.warn('[SourcePicker] load failed', err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const view = map.getView();
    const compute = () => {
      const extent = view.calculateExtent(map.getSize());
      const center = view.getCenter();
      const resolution = view.getResolution();
      const zoom = view.getZoom();
      if (!extent || !center || resolution == null || zoom == null) return;
      const proj = view.getProjection().getCode();
      const lonLat = transformExtent(extent, proj, 'EPSG:4326') as [
        number,
        number,
        number,
        number,
      ];
      setViewState({
        extentLonLat: lonLat,
        extent: [extent[0], extent[1], extent[2], extent[3]],
        center: [center[0], center[1]],
        resolution,
        zoom,
        projection: proj,
      });
    };
    compute();
    map.on('moveend', compute);
    return () => {
      map.un('moveend', compute);
    };
  }, [map]);

  const candidateProjects = viewState
    ? projects
        .filter((p) => intersects(p.bboxLonLat, viewState.extentLonLat))
        .sort(byRecency)
    : [];

  // Fire a probe for every candidate that hasn't been probed at this
  // bucket yet; on each response bump probeVersion so we re-render.
  useEffect(() => {
    if (!viewState) return;
    const { center, resolution, zoom, projection } = viewState;
    for (const p of candidateProjects) {
      if (readCoverage(p.id, center[0], center[1], zoom) != null) continue;
      probeCoverage(
        p.id,
        center[0],
        center[1],
        resolution,
        zoom,
        projection,
      ).then(() => setProbeVersion((v) => v + 1));
    }
    // candidateProjects identity changes every render, but we only care
    // about its content — key on ids to avoid a re-run every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewState,
    candidateProjects.map((p) => p.id).join(','),
  ]);

  const visibleProjects = viewState
    ? candidateProjects.filter((p) => {
        const cov = readCoverage(
          p.id,
          viewState.center[0],
          viewState.center[1],
          viewState.zoom,
        );
        // Keep 'covered' and not-yet-probed (undefined); drop 'blank'.
        return cov !== 'blank';
      })
    : [];

  const isLidarProjectActive = backgroundLayer === 'lidarProject';
  const isLidarMosaicActive = backgroundLayer === 'lidarHillshade';

  const activateProject = (project: LidarProject) => {
    setActiveLidarProject(project);
    setBackgroundLayer('lidarProject');
  };

  const activateStandardMap = () => {
    setBackgroundLayer('topo');
  };

  const activateLidarMosaic = () => {
    setBackgroundLayer('lidarHillshade');
  };

  // Warm wmscache for the lidar candidates the user is likely to try next.
  // Cap to the top few by recency to avoid firing dozens of upstream calls
  // for a long candidate list at low zoom.
  useEffect(() => {
    if (!viewState) return;
    const { extent, resolution, projection } = viewState;
    const activeId = activeLidarProject?.id;
    for (const p of visibleProjects.filter((p) => p.id !== activeId).slice(0, 4)) {
      warmLidarProjectTiles(p.id, extent, resolution, projection);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewState,
    visibleProjects.map((p) => p.id).join(','),
    activeLidarProject?.id,
  ]);

  // Rows in the same order they render, for numeric + bracket shortcuts.
  const rows: Array<{ label: string; activate: () => void }> = [
    { label: 'Standardkart', activate: activateStandardMap },
    { label: 'Nasjonal mosaikk', activate: activateLidarMosaic },
    ...visibleProjects.map((p) => ({
      label: p.projectName,
      activate: () => activateProject(p),
    })),
  ];
  let currentRowIndex = -1;
  if (backgroundLayer === 'topo') currentRowIndex = 0;
  else if (backgroundLayer === 'lidarHillshade') currentRowIndex = 1;
  else if (backgroundLayer === 'lidarProject' && activeLidarProject) {
    const i = visibleProjects.findIndex((p) => p.id === activeLidarProject.id);
    if (i >= 0) currentRowIndex = 2 + i;
  }

  // Keydown handler reads current rows via ref so re-binding isn't needed
  // every render. The listener lives for the picker's lifetime.
  const rowsRef = useRef({ rows, currentRowIndex });
  rowsRef.current = { rows, currentRowIndex };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          t.isContentEditable
        )
          return;
      }
      const { rows: r, currentRowIndex: idx } = rowsRef.current;
      if (r.length === 0) return;
      if (e.key >= '1' && e.key <= '9') {
        const i = Number(e.key) - 1;
        if (i < r.length) {
          e.preventDefault();
          r[i].activate();
        }
        return;
      }
      if (e.key === '[' || e.key === ']') {
        const delta = e.key === ']' ? 1 : -1;
        const start = idx < 0 ? (delta > 0 ? -1 : 0) : idx;
        const next = ((start + delta) % r.length + r.length) % r.length;
        e.preventDefault();
        r[next].activate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Kartverket's per-project renderer sometimes returns only blank PNGs
  // below a zoom threshold that varies per dataset. If we've observed at
  // least a handful of tiles for the current project and most were blank,
  // surface a warning so the user knows to zoom out or pick another one.
  const showBlankWarning =
    isLidarProjectActive &&
    activeLidarProject != null &&
    tileStats.projectId === activeLidarProject.id &&
    tileStats.total >= 4 &&
    tileStats.blank / tileStats.total >= 0.75;

  return (
    <Box
      bg="white"
      borderRadius="lg"
      shadow="lg"
      p={3}
      width="260px"
      maxHeight="70vh"
      overflowY="auto"
      pointerEvents="auto"
    >
      <Text fontSize="sm" fontWeight="semibold" mb={2}>
        Kilder for kartutsnittet
      </Text>

      {showBlankWarning && (
        <Box
          bg="orange.50"
          borderLeft="3px solid"
          borderColor="orange.400"
          px={2}
          py={1.5}
          mb={2}
          borderRadius="sm"
        >
          <Text fontSize="xs" color="orange.800">
            Ingen dekning på dette zoomnivået for «
            {activeLidarProject?.projectName}». Zoom ut eller velg et annet
            prosjekt.
          </Text>
        </Box>
      )}

      <VStack align="stretch" gap={1}>
        <SourceRow
          label="Standardkart (topo)"
          shortcut={shortcutFor(0)}
          active={backgroundLayer === 'topo'}
          onClick={activateStandardMap}
        />

        <Text fontSize="xs" color="gray.500" mt={2}>
          LiDAR ({visibleProjects.length})
        </Text>

        <SourceRow
          label="Nasjonal mosaikk"
          shortcut={shortcutFor(1)}
          badges={['blended']}
          active={isLidarMosaicActive}
          onClick={activateLidarMosaic}
        />

        {visibleProjects.length === 0 && (
          <Text fontSize="xs" color="gray.500">
            Ingen prosjekter dekker dette området.
          </Text>
        )}

        {visibleProjects.map((p, i) => (
          <SourceRow
            key={p.id}
            label={p.projectName}
            shortcut={shortcutFor(2 + i)}
            badges={[
              p.year != null ? String(p.year) : null,
              p.pointDensity,
            ].filter((x): x is string => x != null)}
            active={isLidarProjectActive && activeLidarProject?.id === p.id}
            onClick={() => activateProject(p)}
          />
        ))}
      </VStack>

      <Text fontSize="10px" color="gray.500" mt={2}>
        Snarveier: 1–9 velger direkte · [ og ] blar
      </Text>
    </Box>
  );
};

const shortcutFor = (index: number): string | null =>
  index >= 0 && index <= 8 ? String(index + 1) : null;

const SourceRow = ({
  label,
  shortcut,
  badges,
  active,
  onClick,
}: {
  label: string;
  shortcut?: string | null;
  badges?: string[];
  active: boolean;
  onClick: () => void;
}) => (
  <Button
    variant={active ? 'solid' : 'ghost'}
    colorPalette="green"
    size="xs"
    justifyContent="flex-start"
    onClick={onClick}
    height="auto"
    py={1.5}
    px={2}
    whiteSpace="normal"
    textAlign="left"
  >
    <HStack w="full" justify="space-between" gap={2}>
      <HStack gap={1.5} flex={1} align="center">
        {shortcut && (
          <Text
            fontSize="10px"
            fontFamily="mono"
            px={1}
            minW="14px"
            textAlign="center"
            borderRadius="sm"
            bg={active ? 'whiteAlpha.300' : 'gray.200'}
            color={active ? 'white' : 'gray.700'}
          >
            {shortcut}
          </Text>
        )}
        <Text fontSize="xs" flex={1}>
          {label}
        </Text>
      </HStack>
      {badges && badges.length > 0 && (
        <HStack gap={1}>
          {badges.map((b) => (
            <Text
              key={b}
              fontSize="10px"
              px={1.5}
              py={0}
              borderRadius="sm"
              bg={active ? 'whiteAlpha.300' : 'gray.100'}
            >
              {b}
            </Text>
          ))}
        </HStack>
      )}
    </HStack>
  </Button>
);

const intersects = (
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

const byRecency = (a: LidarProject, b: LidarProject) => {
  const ay = a.year ?? -Infinity;
  const by = b.year ?? -Infinity;
  if (ay !== by) return by - ay;
  const ad = parseDensity(a.pointDensity);
  const bd = parseDensity(b.pointDensity);
  if (ad !== bd) return bd - ad;
  return a.projectName.localeCompare(b.projectName);
};

const parseDensity = (d: string | null): number => {
  if (!d) return 0;
  const m = d.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};
