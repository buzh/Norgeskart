import {
  Box,
  Button,
  Flex,
  Icon,
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
  VStack,
} from '@kvib/react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthButton } from './auth/AuthButton';
import { isSignedInAtom } from './auth/atoms';
import { mapAtom } from './map/atoms';
import { activeThemeLayersAtom } from './map/layers/atoms';
import { backgroundLayerAtom } from './map/layers/config/backgroundLayers/atoms';
import { probeCoverage } from './map/layers/config/backgroundLayers/coverageProbe';
import {
  activeLidarProjectAtom,
  fetchLidarProjects,
  LidarProject,
} from './map/layers/config/backgroundLayers/lidarProjects';
import { ThemeLayerName } from './map/layers/themeWMS';
import { mapToolAtom } from './map/overlay/atoms';
import { MeasurePopover } from './measure/MeasurePopover';
import {
  displaySearchResultsAtom,
  searchQueryAtom,
  useResetSearchResults,
} from './search/atoms';
import type { MapTool } from './Layout';

// Icon + text label stacked vertically. Used for the primary map-mode
// controls (Standard / LiDAR / Kulturminner / Temakart) where a
// persistent label under the icon is worth the extra vertical space.
const LabelledToggleButton = ({
  icon,
  label,
  tooltip,
  active,
  badge,
  onClick,
}: {
  icon: MaterialSymbol;
  label: string;
  tooltip?: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) => (
  <Tooltip
    content={tooltip ?? label}
    positioning={{ placement: 'bottom' }}
  >
    <Box position="relative">
      <Button
        variant={active ? 'primary' : 'tertiary'}
        colorPalette="green"
        onClick={onClick}
        aria-label={tooltip ?? label}
        height="auto"
        minH="52px"
        minW="56px"
        py={1}
        px={2}
      >
        <VStack gap={0} align="center">
          <Icon icon={icon} size={22} />
          <Text
            fontSize="10px"
            fontWeight="medium"
            lineHeight="short"
            mt={0.5}
          >
            {label}
          </Text>
        </VStack>
      </Button>
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

// pointDensity in LidarProject is a string like "10pkt" — parse the
// leading digits so we can sort densest first.
const densityOrder = (d: string | null): number => {
  if (!d) return 0;
  const m = d.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

// Newest first, then densest, then alphabetical.
const sortProjects = (a: LidarProject, b: LidarProject): number => {
  const ay = a.year ?? -Infinity;
  const by = b.year ?? -Infinity;
  if (ay !== by) return by - ay;
  const ad = densityOrder(a.pointDensity);
  const bd = densityOrder(b.pointDensity);
  if (ad !== bd) return bd - ad;
  return a.projectName.localeCompare(b.projectName);
};

const bboxIntersects = (
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

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
  const map = useAtomValue(mapAtom);
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
  const setDisplaySearchResults = useSetAtom(displaySearchResultsAtom);
  const resetSearchResults = useResetSearchResults();
  const [currentMapTool, setCurrentMapTool] = useAtom(mapToolAtom);
  const isSignedIn = useAtomValue(isSignedInAtom);
  const [activeThemeLayers, setActiveThemeLayers] = useAtom(
    activeThemeLayersAtom,
  );
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [activeLidarProject, setActiveLidarProject] = useAtom(
    activeLidarProjectAtom,
  );

  const [lidarOpen, setLidarOpen] = useState(false);
  const [allProjects, setAllProjects] = useState<LidarProject[] | null>(null);

  // Fetch the full LiDAR project catalogue once (WMS GetCapabilities,
  // ~1900 rows, cached in localStorage for a week by fetchLidarProjects
  // itself). Client-side viewport filter then decides what to show in
  // the pulldown — reliable at any zoom, no more "in-view WFS returned
  // zero because the viewport is 900m wide" surprises.
  useEffect(() => {
    let cancelled = false;
    fetchLidarProjects()
      .then((projects) => {
        if (!cancelled) setAllProjects(projects);
      })
      .catch((err) => {
        console.warn('[TopBar] fetchLidarProjects failed', err);
        if (!cancelled) setAllProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter the full catalogue to projects that actually have hillshade
  // pixels at the current viewport center. GetCapabilities bboxes are
  // axis-aligned rectangles, so a large regional project like "Vestfold
  // og Telemark 5pkt 2021" (bbox spans two counties) passes a naive
  // bbox-intersects-viewport test even where its real coverage polygon
  // doesn't reach. The WMS GetMap probe checks the actual pixel data
  // per candidate and only keeps ones that come back as real hillshade.
  const [nearbyProjects, setNearbyProjects] = useState<LidarProject[]>([]);
  const [probing, setProbing] = useState(false);
  useEffect(() => {
    if (!lidarOpen || !allProjects) return;
    const size = map.getSize();
    const center = map.getView().getCenter();
    const resolution = map.getView().getResolution();
    if (!size || !center || resolution == null) return;
    const extent = map.getView().calculateExtent(size);
    if (!extent) return;
    const projection = map.getView().getProjection().getCode();
    const extentLonLat = transformExtent(extent, projection, 'EPSG:4326') as
      | [number, number, number, number]
      | undefined;
    if (!extentLonLat) return;

    // Fast prefilter: strict bbox intersect (no padding). Anything past
    // this still needs the WMS probe to confirm real coverage.
    const bboxCandidates = allProjects
      .filter((p) => bboxIntersects(p.bboxLonLat, extentLonLat))
      .sort(sortProjects);

    setProbing(true);
    let cancelled = false;
    Promise.all(
      bboxCandidates.map((p) =>
        probeCoverage(p.id, center[0], center[1], resolution, projection).then(
          (covered) => ({ p, covered }),
        ),
      ),
    ).then((results) => {
      if (cancelled) return;
      setNearbyProjects(results.filter((r) => r.covered).map((r) => r.p));
      setProbing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [lidarOpen, allProjects, map]);

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

  const openInNorgeIBilder = () => {
    const size = map.getSize();
    if (!size) return;
    const extent = map.getView().calculateExtent(size);
    if (!extent) return;
    const wkid = map
      .getView()
      .getProjection()
      .getCode()
      .replace(/^EPSG:/, '');
    const url =
      `https://norgeibilder.no/?wkid=${wkid}` +
      `&xmin=${extent[0]}&ymin=${extent[1]}` +
      `&xmax=${extent[2]}&ymax=${extent[3]}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const activateNational = () => {
    setBackgroundLayer('lidarHillshade');
    setLidarOpen(false);
  };
  const activateProject = (p: LidarProject) => {
    setActiveLidarProject(p);
    setBackgroundLayer('lidarProject');
    setLidarOpen(false);
  };

  const isLidarProject = backgroundLayer === 'lidarProject';
  const isNationalMosaic = backgroundLayer === 'lidarHillshade';
  const isLidarMode = isLidarProject || isNationalMosaic;
  const lidarChipLabel = isLidarProject && activeLidarProject
    ? activeLidarProject.projectName
    : 'Nasjonal mosaikk';

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

      {/* Base map: Standard topo. */}
      <LabelledToggleButton
        icon="map"
        label="Standard"
        tooltip="Standardkart"
        active={backgroundLayer === 'topo'}
        onClick={() => setBackgroundLayer('topo')}
      />

      {/* LiDAR mode toggle. Activating it defaults to the national mosaic;
          the pulldown next to it (only rendered when LiDAR is active)
          lets the user swap to a specific per-project dataset. */}
      <LabelledToggleButton
        icon="landscape"
        label="LiDAR"
        tooltip="LiDAR (nasjonal mosaikk / per-prosjekt)"
        active={isLidarMode}
        onClick={() => {
          if (!isLidarMode) setBackgroundLayer('lidarHillshade');
        }}
      />

      {/* LiDAR pulldown — only surfaces when LiDAR mode is active. Shows
          current selection and lets the user swap between the national
          mosaic and per-project datasets that actually have coverage at
          the current point. */}
      {isLidarMode && (
        <Popover
          open={lidarOpen}
          onOpenChange={(e) => setLidarOpen(e.open)}
          positioning={{ placement: 'bottom-start', offset: { mainAxis: 8 } }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="secondary"
              colorPalette="green"
              size="sm"
              rightIcon="arrow_drop_down"
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
                LiDAR-prosjekter som dekker dette punktet
              </Text>
              {(allProjects === null || probing) && (
                <Flex align="center" gap={2} p={2}>
                  <Spinner size="xs" />
                  <Text fontSize="xs" color="gray.500">
                    {allProjects === null
                      ? 'Henter katalog…'
                      : 'Sjekker dekning…'}
                  </Text>
                </Flex>
              )}
              {allProjects != null &&
                !probing &&
                nearbyProjects.length === 0 && (
                  <Text fontSize="xs" color="gray.500" px={2} py={1}>
                    Ingen LiDAR-datasett dekker dette punktet. Prøv et annet
                    sted.
                  </Text>
                )}
              {!probing &&
                nearbyProjects.map((p) => {
                const active =
                  isLidarProject && activeLidarProject?.id === p.id;
                const meta = [
                  p.year != null ? String(p.year) : null,
                  p.pointDensity,
                ]
                  .filter((s): s is string => !!s && s.length > 0)
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
      )}

      <Box borderLeft="1px solid" borderColor="gray.200" h="36px" mx={1} />

      {/* Featured overlay: kulturminner (Lokaliteter og enkeltminner).
          Fast one-click toggle for the layer the user opens most often;
          the full kulturminner list lives behind the adjacent Temakart
          card — same layout pattern as the LiDAR icon + pulldown. */}
      <LabelledToggleButton
        icon="castle"
        label="Kulturminner"
        tooltip="Lokaliteter og enkeltminner"
        active={heritageActive}
        onClick={() => toggleThemeLayer('heritageSites')}
      />

      <LabelledToggleButton
        icon="layers"
        label={t('mapLayers.label')}
        tooltip="Alle kulturminne-lag"
        active={currentMapTool === 'layers'}
        badge={activeThemeLayers.size}
        onClick={() => toggleTool('layers')}
      />

      <Box borderLeft="1px solid" borderColor="gray.200" h="36px" mx={1} />

      <LabelledToggleButton
        icon="crop_free"
        label="LiDAR-uttrekk"
        tooltip={t('controller.lidarExtract.text')}
        active={currentMapTool === 'lidarExtract'}
        onClick={() => toggleTool('lidarExtract')}
      />

      <Box borderLeft="1px solid" borderColor="gray.200" h="36px" mx={1} />

      {/* External hop to Kartverket's Norge i bilder viewer at the same
          extent. The site's SPA reads xmin/ymin/xmax/ymax + wkid from
          the query string (verified against their bundle) and defaults
          wkid to 25833 — matches our default projection. */}
      <LabelledToggleButton
        icon="photo_camera"
        label="Flyfoto ↗"
        tooltip="Åpne Norge i bilder for dette utsnittet (ny fane)"
        onClick={openInNorgeIBilder}
      />

      <Box borderLeft="1px solid" borderColor="gray.200" h="36px" mx={1} />

      <ToolButton
        icon="edit"
        label={t('controller.draw.text')}
        active={currentMapTool === 'draw'}
        onClick={() => toggleTool('draw')}
      />

      <MeasurePopover />

      {/* Signed-in-only annotation controls. Hidden entirely for guests
          rather than shown-disabled — the AuthButton at the right is
          the discoverable path in. */}
      {isSignedIn && (
        <>
          <Box borderLeft="1px solid" borderColor="gray.200" h="36px" mx={1} />
          <ToolButton
            icon="bookmark"
            label={t('finds.mineFunn.tabHeading')}
            active={currentMapTool === 'myFinds'}
            onClick={() => toggleTool('myFinds')}
          />
          <ToolButton
            icon="add_location_alt"
            label={t('finds.newFind.tabHeading')}
            active={currentMapTool === 'newFind'}
            onClick={() => toggleTool('newFind')}
          />
        </>
      )}

      <Box flex="1" minW={1} />
      <AuthButton />
    </Flex>
  );
};
