import {
  Badge,
  Box,
  Flex,
  IconButton,
  Stack,
  Text,
} from '@kvib/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Overlay } from 'ol';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { mapAtom } from '../atoms';
import { activeLidarProjectAtom } from '../layers/config/backgroundLayers/lidarProjects';
import {
  activateCoverageProject,
  coveragePickerAtom,
} from './coverageOverlay';
import type { CoverageProject } from './wfsCoverage';

// Density → same green ramp as the map polygons so users can visually
// correlate a row's dot with the polygon underneath.
const dotColorFor = (density: number | null): string => {
  if (density == null || density === 0) return 'hsl(0, 0%, 55%)';
  const clamped = Math.min(density, 20);
  const lightness = 55 - clamped * 1.5;
  return `hsl(150, 70%, ${lightness}%)`;
};

// Newest first, then densest, then alphabetical — matches how a user
// browsing LiDAR would typically want them ranked.
const sortProjects = (a: CoverageProject, b: CoverageProject): number => {
  const ay = a.year ?? -Infinity;
  const by = b.year ?? -Infinity;
  if (ay !== by) return by - ay;
  const ad = a.pointDensity ?? -Infinity;
  const bd = b.pointDensity ?? -Infinity;
  if (ad !== bd) return bd - ad;
  return a.projectName.localeCompare(b.projectName);
};

const formatDensity = (d: number | null): string =>
  d == null ? '' : `${d.toFixed(d < 10 ? 1 : 0)} pkt/m²`;

const ProjectRow = ({
  project,
  active,
  onClick,
}: {
  project: CoverageProject;
  active: boolean;
  onClick: () => void;
}) => {
  const density = formatDensity(project.pointDensity);
  return (
    <Box
      as="button"
      onClick={onClick}
      textAlign="left"
      w="full"
      py={1.5}
      px={2}
      borderRadius="md"
      borderWidth="1px"
      borderColor={active ? 'green.500' : 'transparent'}
      bg={active ? 'green.50' : 'white'}
      _hover={{ bg: active ? 'green.100' : 'gray.50' }}
      cursor="pointer"
    >
      <Flex gap={2} align="center">
        <Box
          w="10px"
          h="10px"
          borderRadius="full"
          bg={dotColorFor(project.pointDensity)}
          flexShrink={0}
        />
        <Box flex={1} minW={0}>
          <Text
            fontSize="sm"
            fontWeight={active ? 'semibold' : 'normal'}
            wordBreak="break-word"
            lineClamp={2}
          >
            {project.projectName}
          </Text>
          <Flex gap={1.5} mt={0.5} align="center" wrap="wrap">
            {project.year != null && (
              <Text fontSize="xs" color="gray.600">
                {project.year}
              </Text>
            )}
            {density && (
              <Text fontSize="xs" color="gray.600">
                · {density}
              </Text>
            )}
            {active && (
              <Badge colorPalette="green" size="sm">
                Aktiv
              </Badge>
            )}
          </Flex>
        </Box>
      </Flex>
    </Box>
  );
};

const PopupContent = ({
  projects,
  activeId,
  onSelect,
  onClose,
}: {
  projects: CoverageProject[];
  activeId: string | null;
  onSelect: (p: CoverageProject) => void;
  onClose: () => void;
}) => {
  const sorted = [...projects].sort(sortProjects);
  return (
    <Box
      bg="white"
      borderRadius="10px"
      boxShadow="0 4px 12px rgba(0,0,0,0.2)"
      p={2.5}
      w="260px"
      maxH="50vh"
      overflowY="auto"
      pointerEvents="auto"
    >
      <Flex justify="space-between" align="center" mb={2} gap={2}>
        <Text fontSize="xs" fontWeight="semibold" color="gray.700">
          LiDAR-datasett her ({sorted.length})
        </Text>
        <IconButton
          onClick={onClose}
          icon="close"
          variant="ghost"
          size="xs"
          aria-label="Lukk"
        />
      </Flex>
      <Stack gap={1.5}>
        {sorted.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            active={activeId === p.id}
            onClick={() => onSelect(p)}
          />
        ))}
      </Stack>
    </Box>
  );
};

export const CoverageOverlapPopup = () => {
  const state = useAtomValue(coveragePickerAtom);
  const setState = useSetAtom(coveragePickerAtom);
  const activeProject = useAtomValue(activeLidarProjectAtom);
  const map = useAtomValue(mapAtom);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<Overlay | null>(null);

  if (!containerRef.current) {
    const el = document.createElement('div');
    el.style.pointerEvents = 'none';
    containerRef.current = el;
  }

  useEffect(() => {
    if (!map || !containerRef.current) return;
    const overlay = new Overlay({
      element: containerRef.current,
      positioning: 'bottom-center',
      offset: [0, -12],
      stopEvent: true,
      autoPan: { animation: { duration: 200 } },
    });
    overlayRef.current = overlay;
    map.addOverlay(overlay);
    return () => {
      map.removeOverlay(overlay);
      overlayRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    overlayRef.current?.setPosition(state?.coordinate);
  }, [state]);

  if (!state || !containerRef.current) return null;

  return createPortal(
    <PopupContent
      projects={state.projects}
      activeId={activeProject?.id ?? null}
      onSelect={(p) => {
        activateCoverageProject(p);
        setState(null);
      }}
      onClose={() => setState(null)}
    />,
    containerRef.current,
  );
};
