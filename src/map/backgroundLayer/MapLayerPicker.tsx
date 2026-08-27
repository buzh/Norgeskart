import { Box, Button, Checkbox, Stack, Text } from '@kvib/react';
import { useAtom, useAtomValue } from 'jotai';
import { backgroundLayerAtom } from '../layers/config/backgroundLayers/atoms';
import { activeLidarProjectAtom } from '../layers/config/backgroundLayers/lidarProjects';
import { showCoverageOverlayAtom } from './coverageOverlay';

export const MapLayerPicker = () => {
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const activeProject = useAtomValue(activeLidarProjectAtom);
  const [showCoverage, setShowCoverage] = useAtom(showCoverageOverlayAtom);

  const isProjectActive = backgroundLayer === 'lidarProject';

  return (
    <Box
      bg="white"
      borderRadius="lg"
      shadow="lg"
      p={3}
      width="100%"
      pointerEvents="auto"
    >
      <Text fontSize="sm" fontWeight="semibold" mb={2}>
        Kartlag
      </Text>

      <Stack gap={1} mb={isProjectActive ? 2 : 3}>
        <LayerRow
          label="Standardkart"
          active={backgroundLayer === 'topo'}
          onClick={() => setBackgroundLayer('topo')}
        />
        <LayerRow
          label="Terrengskygge"
          active={backgroundLayer === 'lidarHillshade'}
          onClick={() => setBackgroundLayer('lidarHillshade')}
        />
      </Stack>

      {isProjectActive && activeProject && (
        <Box
          bg="green.50"
          borderLeft="3px solid"
          borderColor="green.500"
          px={2}
          py={1.5}
          mb={3}
          borderRadius="sm"
        >
          <Text fontSize="10px" color="green.900" fontWeight="semibold">
            LiDAR-prosjekt
          </Text>
          <Text
            fontSize="xs"
            color="green.900"
            title={activeProject.projectName}
            lineClamp={2}
          >
            {activeProject.projectName}
          </Text>
        </Box>
      )}

      <Checkbox
        checked={showCoverage}
        onCheckedChange={(e) => setShowCoverage(e.checked.valueOf() as boolean)}
        size="sm"
      >
        <Text fontSize="xs">Vis LiDAR-dekning</Text>
      </Checkbox>
      {showCoverage && (
        <Text fontSize="10px" color="gray.500" mt={1.5}>
          Fargenyanse angir punkttetthet. Klikk et område for å bytte til
          det datasettet.
        </Text>
      )}
    </Box>
  );
};

const LayerRow = ({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <Button
    variant={active ? 'solid' : 'ghost'}
    colorPalette="green"
    size="sm"
    justifyContent="flex-start"
    onClick={onClick}
    height="auto"
    py={1.5}
    px={2}
    fontSize="xs"
  >
    {label}
  </Button>
);

