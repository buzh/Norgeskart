import {
  Box,
  Button,
  Flex,
  IconButton,
  MaterialSymbol,
  Search,
  Text,
  Tooltip,
} from '@kvib/react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import LanguageSwitcher from './languageswitcher/LanguageSwitcher';
import { showCoverageOverlayAtom } from './map/backgroundLayer/coverageOverlay';
import { trackPositionAtom } from './map/geolocation/atoms';
import { activeThemeLayersAtom } from './map/layers/atoms';
import { ThemeLayerName } from './map/layers/themeWMS';
import { backgroundLayerAtom } from './map/layers/config/backgroundLayers/atoms';
import { activeLidarProjectAtom } from './map/layers/config/backgroundLayers/lidarProjects';
import { useMapSettings } from './map/mapHooks';
import { mapToolAtom } from './map/overlay/atoms';
import { MeasurePopover } from './measure/MeasurePopover';
import {
  displaySearchResultsAtom,
  searchQueryAtom,
  useResetSearchResults,
} from './search/atoms';
import type { MapTool } from './Layout';

const ToolButton = ({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: MaterialSymbol;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) => (
  <Tooltip content={label} positioning={{ placement: 'bottom' }}>
    <Box position="relative">
      <IconButton
        icon={icon}
        aria-label={label}
        variant={active ? 'primary' : 'tertiary'}
        onClick={onClick}
      />
      {badge != null && badge > 0 && (
        <Text
          position="absolute"
          top="-4px"
          right="-4px"
          bg="#FFDD9D"
          borderRadius="full"
          border="2px solid white"
          px={1.5}
          py={0}
          minW="18px"
          textAlign="center"
          pointerEvents="none"
          fontSize="10px"
          fontWeight="bold"
          lineHeight="14px"
        >
          {badge}
        </Text>
      )}
    </Box>
  </Tooltip>
);

export const TopBar = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
  const setDisplaySearchResults = useSetAtom(displaySearchResultsAtom);
  const resetSearchResults = useResetSearchResults();
  const [currentMapTool, setCurrentMapTool] = useAtom(mapToolAtom);
  const [activeThemeLayers, setActiveThemeLayers] = useAtom(
    activeThemeLayersAtom,
  );

  const toggleThemeLayer = (name: ThemeLayerName) => {
    setActiveThemeLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const heritageActive = activeThemeLayers.has('heritageSites');
  const [trackPosition, setTrackPosition] = useAtom(trackPositionAtom);
  const { setMapFullScreen } = useMapSettings();
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const activeLidarProject = useAtomValue(activeLidarProjectAtom);
  const [showCoverage, setShowCoverage] = useAtom(showCoverageOverlayAtom);

  const toggleTool = (name: Exclude<MapTool, null>) => {
    setCurrentMapTool(currentMapTool === name ? null : name);
  };

  const handleFullScreenClick = () => {
    if (document.fullscreenElement) {
      setMapFullScreen(false);
    } else {
      setMapFullScreen(true);
    }
  };

  const isLidarProject = backgroundLayer === 'lidarProject';
  const lidarChipVariant = showCoverage
    ? 'primary'
    : isLidarProject
      ? 'secondary'
      : 'tertiary';
  const lidarChipLabel =
    isLidarProject && activeLidarProject
      ? activeLidarProject.projectName
      : 'Vis LiDAR-dekning';

  return (
    <Flex
      as="header"
      h={{ base: '56px', md: '60px' }}
      align="center"
      gap={{ base: 1, md: 2 }}
      px={{ base: 2, md: 3 }}
      bg="white"
      boxShadow="sm"
      pointerEvents="auto"
      overflowX={{ base: 'auto', md: 'visible' }}
      flexShrink={0}
      zIndex={20}
    >
      <Box position="relative" flex="1 1 240px" maxW="420px" minW="140px">
        <Search
          placeholder={t('search.placeholder')}
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
          }}
          onClick={() => setDisplaySearchResults(true)}
          height="42px"
          bg="white"
          maxLength={100}
        />
        {searchQuery !== '' && (
          <IconButton
            icon="close"
            variant="ghost"
            size="xs"
            aria-label="Tøm søk"
            onClick={resetSearchResults}
            position="absolute"
            right="4px"
            top="50%"
            style={{ transform: 'translateY(-50%)' }}
          />
        )}
      </Box>

      {/* Base map: two direct icon toggles instead of a hidden pulldown. */}
      <Tooltip content="Standardkart" positioning={{ placement: 'bottom' }}>
        <IconButton
          icon="map"
          aria-label="Standardkart"
          variant={backgroundLayer === 'topo' ? 'primary' : 'tertiary'}
          onClick={() => setBackgroundLayer('topo')}
        />
      </Tooltip>
      <Tooltip
        content="Terrengskygge (nasjonal LiDAR-mosaikk)"
        positioning={{ placement: 'bottom' }}
      >
        <IconButton
          icon="landscape"
          aria-label="Terrengskygge (nasjonal LiDAR-mosaikk)"
          variant={
            backgroundLayer === 'lidarHillshade' ? 'primary' : 'tertiary'
          }
          onClick={() => setBackgroundLayer('lidarHillshade')}
        />
      </Tooltip>

      {/* LiDAR project chip. Doubles as coverage-overlay toggle and as the
          persistent readout of the currently-active project. */}
      <Tooltip
        content={
          isLidarProject
            ? 'Klikk for å bytte LiDAR-datasett'
            : 'Slå på LiDAR-dekning for å velge et datasett'
        }
        positioning={{ placement: 'bottom' }}
      >
        <Button
          variant={lidarChipVariant}
          colorPalette="green"
          size="sm"
          leftIcon="radar"
          onClick={() => setShowCoverage((s) => !s)}
          maxW="220px"
          overflow="hidden"
        >
          <Text
            fontSize="xs"
            lineHeight="short"
            whiteSpace="nowrap"
            textOverflow="ellipsis"
            overflow="hidden"
          >
            {lidarChipLabel}
          </Text>
        </Button>
      </Tooltip>

      {/* Featured overlay: kulturminner (Lokaliteter og enkeltminner).
          Fast one-click toggle for the layer the user opens most often;
          the fuller kulturminner list still lives behind the Temakart
          card. */}
      <Tooltip
        content="Lokaliteter og enkeltminner (Kulturminner)"
        positioning={{ placement: 'bottom' }}
      >
        <IconButton
          icon="castle"
          aria-label="Lokaliteter og enkeltminner"
          variant={heritageActive ? 'primary' : 'tertiary'}
          onClick={() => toggleThemeLayer('heritageSites')}
        />
      </Tooltip>

      <Box borderLeft="1px solid" borderColor="gray.200" h="24px" mx={1} />

      <ToolButton
        icon="layers"
        label={t('mapLayers.label')}
        active={currentMapTool === 'layers'}
        badge={activeThemeLayers.size}
        onClick={() => toggleTool('layers')}
      />

      <ToolButton
        icon="edit"
        label={t('controller.draw.text')}
        active={currentMapTool === 'draw'}
        onClick={() => toggleTool('draw')}
      />

      <MeasurePopover />

      <ToolButton
        icon="crop_free"
        label={t('controller.lidarExtract.text')}
        active={currentMapTool === 'lidarExtract'}
        onClick={() => toggleTool('lidarExtract')}
      />

      <Box flex="1" minW={1} />

      {typeof navigator !== 'undefined' && navigator.geolocation && (
        <ToolButton
          icon={trackPosition ? 'location_disabled' : 'my_location'}
          label={
            trackPosition
              ? t('map.controls.myLocation.disable.label')
              : t('map.controls.myLocation.enable.label')
          }
          active={trackPosition}
          onClick={() => setTrackPosition((p) => !p)}
        />
      )}

      <ToolButton
        icon="fullscreen"
        label={t('map.controls.fullscreen.label')}
        onClick={handleFullScreenClick}
      />

      <ToolButton
        icon="help"
        label={t('controller.help.mobiletext')}
        onClick={() => navigate('/hjelp')}
      />

      <LanguageSwitcher variant="icon" />
    </Flex>
  );
};
