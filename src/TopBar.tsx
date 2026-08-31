import {
  Box,
  Button,
  Flex,
  IconButton,
  MaterialSymbol,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Search,
  Spinner,
  Stack,
  Text,
  Tooltip,
} from '@kvib/react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import LanguageSwitcher from './languageswitcher/LanguageSwitcher';
import type { CoverageProject } from './map/backgroundLayer/wfsCoverage';
import { fetchCoverageInBbox } from './map/backgroundLayer/wfsCoverage';
import { mapAtom } from './map/atoms';
import { trackPositionAtom } from './map/geolocation/atoms';
import { activeThemeLayersAtom } from './map/layers/atoms';
import { backgroundLayerAtom } from './map/layers/config/backgroundLayers/atoms';
import { activeLidarProjectAtom } from './map/layers/config/backgroundLayers/lidarProjects';
import { ThemeLayerName } from './map/layers/themeWMS';
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

const LidarPulldownItem = ({
  label,
  meta,
  active,
  onClick,
}: {
  label: string;
  meta?: string;
  active: boolean;
  onClick: () => void;
}) => (
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
    <Text
      fontSize="sm"
      fontWeight={active ? 'semibold' : 'normal'}
      wordBreak="break-word"
      lineClamp={2}
    >
      {label}
    </Text>
    {meta && (
      <Text fontSize="xs" color="gray.600" mt={0.5}>
        {meta}
      </Text>
    )}
  </Box>
);

export const TopBar = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const map = useAtomValue(mapAtom);
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
  const setDisplaySearchResults = useSetAtom(displaySearchResultsAtom);
  const resetSearchResults = useResetSearchResults();
  const [currentMapTool, setCurrentMapTool] = useAtom(mapToolAtom);
  const [activeThemeLayers, setActiveThemeLayers] = useAtom(
    activeThemeLayersAtom,
  );
  const [trackPosition, setTrackPosition] = useAtom(trackPositionAtom);
  const { setMapFullScreen } = useMapSettings();
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [activeLidarProject, setActiveLidarProject] = useAtom(
    activeLidarProjectAtom,
  );

  const [lidarOpen, setLidarOpen] = useState(false);
  const [inViewProjects, setInViewProjects] = useState<
    CoverageProject[] | null
  >(null);

  useEffect(() => {
    if (!lidarOpen) return;
    const size = map.getSize();
    if (!size) return;
    const extent = map.getView().calculateExtent(size);
    if (!extent) return;
    const projection = map.getView().getProjection().getCode();
    setInViewProjects(null);
    let cancelled = false;
    fetchCoverageInBbox(
      [extent[0], extent[1], extent[2], extent[3]],
      projection,
    )
      .then((projects) => {
        if (!cancelled) setInViewProjects(projects.sort(sortProjects));
      })
      .catch((err) => {
        console.warn('[TopBar] WFS coverage fetch failed', err);
        if (!cancelled) setInViewProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lidarOpen, map]);

  const toggleTool = (name: Exclude<MapTool, null>) => {
    setCurrentMapTool(currentMapTool === name ? null : name);
  };

  const toggleThemeLayer = (name: ThemeLayerName) => {
    setActiveThemeLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const heritageActive = activeThemeLayers.has('heritageSites');

  const handleFullScreenClick = () => {
    if (document.fullscreenElement) {
      setMapFullScreen(false);
    } else {
      setMapFullScreen(true);
    }
  };

  const activateNational = () => {
    setBackgroundLayer('lidarHillshade');
    setLidarOpen(false);
  };
  const activateProject = (p: CoverageProject) => {
    setActiveLidarProject({
      id: p.id,
      projectName: p.projectName,
      year: p.year,
      pointDensity: p.pointDensity,
    });
    setBackgroundLayer('lidarProject');
    setLidarOpen(false);
  };

  const isLidarProject = backgroundLayer === 'lidarProject';
  const isNationalMosaic = backgroundLayer === 'lidarHillshade';
  const lidarChipLabel = isLidarProject && activeLidarProject
    ? activeLidarProject.projectName
    : isNationalMosaic
      ? 'Nasjonal mosaikk'
      : 'Velg LiDAR';
  const lidarChipVariant =
    isLidarProject || isNationalMosaic ? 'secondary' : 'tertiary';

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

      {/* Base map: Standard topo. LiDAR variants (Nasjonal + per-project)
          live in the pulldown to the right. */}
      <Tooltip content="Standardkart" positioning={{ placement: 'bottom' }}>
        <IconButton
          icon="map"
          aria-label="Standardkart"
          variant={backgroundLayer === 'topo' ? 'primary' : 'tertiary'}
          onClick={() => setBackgroundLayer('topo')}
        />
      </Tooltip>

      {/* LiDAR pulldown. Shows current selection; opens a menu of the
          national mosaic + every LiDAR project intersecting the current
          viewport. */}
      <Popover
        open={lidarOpen}
        onOpenChange={(e) => setLidarOpen(e.open)}
        positioning={{ placement: 'bottom-start', offset: { mainAxis: 8 } }}
      >
        <PopoverTrigger asChild>
          <Button
            variant={lidarChipVariant}
            colorPalette="green"
            size="sm"
            leftIcon="radar"
            rightIcon="expand_more"
            maxW="240px"
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
        </PopoverTrigger>
        <PopoverContent width="280px" p={0} borderRadius="lg">
          <PopoverArrow />
          <PopoverBody p={2}>
            <Stack gap={1}>
              <LidarPulldownItem
                label="Nasjonal mosaikk"
                meta="Kartverket høydedata (hele Norge)"
                active={isNationalMosaic}
                onClick={activateNational}
              />
              <Box
                borderTop="1px solid"
                borderColor="gray.200"
                my={1}
                mx={1}
              />
              <Text fontSize="10px" color="gray.500" px={2}>
                LiDAR-prosjekter i visningen
              </Text>
              {inViewProjects === null && (
                <Flex align="center" gap={2} p={2}>
                  <Spinner size="xs" />
                  <Text fontSize="xs" color="gray.500">
                    Henter...
                  </Text>
                </Flex>
              )}
              {inViewProjects != null && inViewProjects.length === 0 && (
                <Text fontSize="xs" color="gray.500" px={2} py={1}>
                  Ingen LiDAR-datasett dekker dette området. Pan eller zoom
                  til et annet område.
                </Text>
              )}
              {inViewProjects?.map((p) => {
                const active =
                  isLidarProject && activeLidarProject?.id === p.id;
                const meta = [
                  p.year != null ? String(p.year) : null,
                  formatDensity(p.pointDensity),
                ]
                  .filter((s) => s && s.length > 0)
                  .join(' · ');
                return (
                  <LidarPulldownItem
                    key={p.id}
                    label={p.projectName}
                    meta={meta}
                    active={active}
                    onClick={() => activateProject(p)}
                  />
                );
              })}
            </Stack>
          </PopoverBody>
        </PopoverContent>
      </Popover>

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
