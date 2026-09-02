import {
  Box,
  Flex,
  Heading,
  HStack,
  IconButton,
  Text,
  Tooltip,
  VStack,
} from '@kvib/react';

import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { LidarExtractPanel } from '../../lidarExtract/LidarExtractPanel';
import { LocalitiesPanel } from '../../localities/LocalitiesPanel';
import { MapThemes } from '../../settings/map/themes/MapThemes';
import { useIsMobileScreen } from '../../shared/hooks';
import { activeThemeLayersAtom } from '../layers/atoms';
import { mapToolAtom } from './atoms';

const MapLayersCardHeader = () => {
  const { t } = useTranslation();
  const [activeThemeLayers, setActiveThemeLayers] = useAtom(
    activeThemeLayersAtom,
  );
  return (
    <HStack mb={{ base: '0', md: '2' }} h={6}>
      <Heading fontWeight="bold" size="md">
        {t('mapLayers.label')}
      </Heading>
      {activeThemeLayers.size > 0 && (
        <HStack gap={0.5}>
          <Text
            backgroundColor={'#FFDD9D'}
            borderRadius="full"
            borderWidth={'2px'}
            borderColor={'white'}
            px={2}
            py={0.5}
            pointerEvents={'none'}
            fontSize={'sm'}
          >
            {activeThemeLayers.size}
          </Text>
          <Tooltip content={t('map.settings.layers.theme.resetbutton.text')}>
            <IconButton
              variant="tertiary"
              colorPalette={'red'}
              size={'md'}
              visibility={activeThemeLayers.size > 0 ? 'visible' : 'hidden'}
              onClick={() => {
                setActiveThemeLayers(new Set());
              }}
              icon={'playlist_remove'}
            />
          </Tooltip>
        </HStack>
      )}
    </HStack>
  );
};

const MapToolCardHeader = ({ label }: { label: string | React.ReactNode }) => {
  const isLabelString = typeof label === 'string';
  return isLabelString ? (
    <Heading
      fontWeight="bold"
      mb={{ base: '0', md: '2' }}
      size={{ base: 'sm', md: 'md' }}
    >
      {label}
    </Heading>
  ) : (
    <>{label}</>
  );
};

export const MapToolCards = () => {
  return (
    <Box pointerEvents={'none'} w="100%">
      <MapToolCardsBody />
    </Box>
  );
};

const MapToolCardsBody = () => {
  const { t } = useTranslation();
  const [currentMapTool, setCurrentMapTool] = useAtom(mapToolAtom);

  const onClose = () => {
    setCurrentMapTool(null);
  };

  if (currentMapTool === 'layers') {
    return (
      <MapToolCard label={<MapLayersCardHeader />} onClose={onClose}>
        <MapThemes />
      </MapToolCard>
    );
  }

  if (currentMapTool === 'lidarExtract') {
    return (
      <MapToolCard label={t('lidarExtract.tabHeading')} onClose={onClose}>
        <LidarExtractPanel />
      </MapToolCard>
    );
  }

  if (currentMapTool === 'localities') {
    return (
      <MapToolCard label={t('localities.panel.tabHeading')} onClose={onClose}>
        <LocalitiesPanel />
      </MapToolCard>
    );
  }
};

interface MapToolCardProps {
  label: string | React.ReactNode;
  children: React.ReactNode | React.ReactNode[] | undefined;
  onClose: () => void;
  hideHeader?: boolean;
}
const MapToolCard = ({
  label,
  children,
  onClose,
  hideHeader,
}: MapToolCardProps) => {
  const isMobile = useIsMobileScreen();

  return (
    <VStack
      width="100%"
      maxWidth={{ base: '100%', md: '345px' }}
      maxHeight={isMobile ? '80dvh' : 'calc(100vh - 65px)'}
      pointerEvents="auto"
      bg="#FFFF"
      shadow="lg"
      p={4}
      m={{ base: 0, md: 1 }}
      mr={{ base: 0, md: 3 }}
      borderRadius="16px"
      borderBottomLeftRadius={{ base: '0px', md: '16px' }}
      borderBottomRightRadius={{ base: '0px', md: '16px' }}
      overflowY="auto"
    >
      <Flex justify="space-between" gap="2" w="100%" align="center">
        {!hideHeader ? <MapToolCardHeader label={label} /> : <Box />}

        <IconButton
          variant="ghost"
          icon="close"
          aria-label="Lukk"
          colorPalette="red"
          onClick={onClose}
          size={{ base: 'xs', md: 'sm' }}
        />
      </Flex>

      <Box w="100%" overflowY="auto" maxHeight="90%">
        {children}
      </Box>
    </VStack>
  );
};
