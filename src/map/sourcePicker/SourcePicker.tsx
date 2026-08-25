import { Box, Button, HStack, Text, VStack } from '@kvib/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useEffect, useState } from 'react';
import { mapAtom } from '../atoms';
import { backgroundLayerAtom } from '../layers/config/backgroundLayers/atoms';
import {
  activeLidarProjectAtom,
  fetchLidarProjects,
  LidarProject,
  lidarProjectTileStatsAtom,
} from '../layers/config/backgroundLayers/lidarProjects';

export const SourcePicker = () => {
  const map = useAtomValue(mapAtom);
  const backgroundLayer = useAtomValue(backgroundLayerAtom);
  const activeLidarProject = useAtomValue(activeLidarProjectAtom);
  const setBackgroundLayer = useSetAtom(backgroundLayerAtom);
  const setActiveLidarProject = useSetAtom(activeLidarProjectAtom);
  const tileStats = useAtomValue(lidarProjectTileStatsAtom);

  const [projects, setProjects] = useState<LidarProject[]>([]);
  const [viewExtentLonLat, setViewExtentLonLat] = useState<
    [number, number, number, number] | null
  >(null);

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
      if (!extent) return;
      const proj = view.getProjection().getCode();
      const lonLat = transformExtent(extent, proj, 'EPSG:4326') as [
        number,
        number,
        number,
        number,
      ];
      setViewExtentLonLat(lonLat);
    };
    compute();
    map.on('moveend', compute);
    return () => {
      map.un('moveend', compute);
    };
  }, [map]);

  const visibleProjects = viewExtentLonLat
    ? projects
        .filter((p) => intersects(p.bboxLonLat, viewExtentLonLat))
        .sort(byRecency)
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
          active={backgroundLayer === 'topo'}
          onClick={activateStandardMap}
        />

        <Text fontSize="xs" color="gray.500" mt={2}>
          LiDAR ({visibleProjects.length})
        </Text>

        <SourceRow
          label="Nasjonal mosaikk"
          badges={['blended']}
          active={isLidarMosaicActive}
          onClick={activateLidarMosaic}
        />

        {visibleProjects.length === 0 && (
          <Text fontSize="xs" color="gray.500">
            Ingen prosjekter dekker dette området.
          </Text>
        )}

        {visibleProjects.map((p) => (
          <SourceRow
            key={p.id}
            label={p.projectName}
            badges={[
              p.year != null ? String(p.year) : null,
              p.pointDensity,
            ].filter((x): x is string => x != null)}
            active={isLidarProjectActive && activeLidarProject?.id === p.id}
            onClick={() => activateProject(p)}
          />
        ))}
      </VStack>
    </Box>
  );
};

const SourceRow = ({
  label,
  badges,
  active,
  onClick,
}: {
  label: string;
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
      <Text fontSize="xs" flex={1}>
        {label}
      </Text>
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
