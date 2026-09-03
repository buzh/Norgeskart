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
  Switch,
  Text,
  Tooltip,
  VStack,
} from '@kvib/react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthButton } from './auth/AuthButton';
import { isSignedInAtom } from './auth/atoms';
import { lidarExtractViewerOpenAtom } from './lidarExtract/atoms';
import { creatingLocalityAtom } from './localities/atoms';
import { mapAtom } from './map/atoms';
import { activeThemeLayersAtom } from './map/layers/atoms';
import { backgroundLayerAtom } from './map/layers/config/backgroundLayers/atoms';
import {
  activeLidarProjectAtom,
  activeLidarStyleAtom,
  bboxIntersects,
  DEFAULT_LIDAR_PROJECT_STYLE,
  fetchLidarProjects,
  fetchNationalLidarStyles,
  LidarProject,
  resolveLidarStyle,
  TIER_A_STYLES,
} from './map/layers/config/backgroundLayers/lidarProjects';
import {
  DEFAULT_LIDAR_FILTERS,
  hoveredLidarProjectIdAtom,
  lidarFilterSettingsAtom,
  lidarPickerOpenAtom,
  lidarViewportAtom,
  LidarViewportEntry,
} from './map/layers/config/backgroundLayers/lidarRelevance';
import { ThemeLayerName } from './map/layers/themeWMS';
import { mapToolAtom } from './map/overlay/atoms';
import { MeasurePopover } from './measure/MeasurePopover';
import {
  displaySearchResultsAtom,
  searchQueryAtom,
  useResetSearchResults,
} from './search/atoms';
import type { MapTool } from './Layout';

// Small count pill, absolutely positioned over whatever it's nested in.
// Shared by the LiDAR/Kartlag toggle buttons and the style-pulldown chip.
const CountBadge = ({ value }: { value?: number }) =>
  value != null && value > 0 ? (
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
      {value}
    </Text>
  ) : null;

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
      <CountBadge value={badge} />
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
      <CountBadge value={badge} />
    </Box>
  </Tooltip>
);

const CURRENT_YEAR = new Date().getFullYear();

// One dataset per line, name truncated, year/density right-aligned.
// Deliberately single-line and borderless: a viewport can turn up
// RENDER_CAP entries, and the earlier two-line bordered card ran the
// list off the bottom of the screen. Selection is a left rule rather
// than a full border so rows still scan as a column.
//
// `onHover` fires for pointer *and* focus, so tabbing the list lights up
// the same footprint on the map that mousing it would.
const LidarPulldownItem = ({
  label,
  meta,
  active,
  onActivate,
  onHover,
}: {
  label: string;
  meta?: string;
  active: boolean;
  onActivate: () => void;
  onHover?: (hovering: boolean) => void;
}) => (
  <Flex
    as="button"
    onClick={onActivate}
    onMouseEnter={() => onHover?.(true)}
    onMouseLeave={() => onHover?.(false)}
    onFocus={() => onHover?.(true)}
    onBlur={() => onHover?.(false)}
    title={label}
    align="center"
    gap={2}
    w="full"
    textAlign="left"
    py={1}
    pl={2}
    pr={2}
    borderLeft="3px solid"
    borderLeftColor={active ? 'green.500' : 'transparent'}
    bg={active ? 'green.50' : 'transparent'}
    _hover={{ bg: active ? 'green.100' : 'gray.100' }}
    cursor="pointer"
  >
    <Text
      fontSize="xs"
      fontWeight={active ? 'semibold' : 'normal'}
      flex="1"
      minW={0}
      whiteSpace="nowrap"
      overflow="hidden"
      textOverflow="ellipsis"
    >
      {label}
    </Text>
    {meta && (
      <Text
        fontSize="10px"
        color="gray.500"
        flexShrink={0}
        whiteSpace="nowrap"
      >
        {meta}
      </Text>
    )}
  </Flex>
);

// Row that opens/closes an overflow group, chevron first — same shape as
// the theme layer picker's subtheme trigger.
const LidarDisclosure = ({
  open,
  label,
  onToggle,
}: {
  open: boolean;
  label: string;
  onToggle: () => void;
}) => (
  <Flex
    as="button"
    onClick={onToggle}
    align="center"
    gap={1}
    w="full"
    textAlign="left"
    py={1}
    px={2}
    _hover={{ bg: 'gray.100' }}
    cursor="pointer"
  >
    <Box
      display="flex"
      transform={open ? 'rotate(90deg)' : 'none'}
      color="gray.600"
    >
      <Icon icon="chevron_forward" size={16} />
    </Box>
    <Text fontSize="xs" color="gray.600">
      {label}
    </Text>
  </Flex>
);

// Worth a column of its own because it's what the list is ordered by:
// how much of the current screen this project's footprint paints.
const coverageLabel = (ratio: number): string | null =>
  ratio <= 0 ? null : ratio < 0.01 ? '<1%' : `${Math.round(ratio * 100)}%`;

const projectMeta = (entry: LidarViewportEntry): string =>
  [
    entry.project.year != null ? String(entry.project.year) : null,
    entry.project.pointDensity,
    coverageLabel(entry.areaRatio),
  ]
    .filter((s): s is string => !!s && s.length > 0)
    .join(' · ');

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

  const [creatingLocality, setCreatingLocality] = useAtom(
    creatingLocalityAtom,
  );

  // Shared, not local state: the map-side footprint overlay is drawn
  // only while this pulldown is open, and only for the row under the
  // pointer (see lidarFootprintsLayer).
  const [lidarOpen, setLidarOpen] = useAtom(lidarPickerOpenAtom);
  const setHoveredLidarProjectId = useSetAtom(hoveredLidarProjectIdAtom);
  const [styleOpen, setStyleOpen] = useState(false);
  const [moreProjectsOpen, setMoreProjectsOpen] = useState(false);
  const [moreStylesOpen, setMoreStylesOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [allProjects, setAllProjects] = useState<LidarProject[] | null>(null);
  const [nationalStyles, setNationalStyles] = useState<string[]>([]);
  const [filters, setFilters] = useAtom(lidarFilterSettingsAtom);
  const [activeLidarStyle, setActiveLidarStyle] = useAtom(
    activeLidarStyleAtom,
  );
  // Coverage-confirmed, tiered, capped viewport data — fetched once (in
  // lidarFootprintsLayer.ts, mounted from Layout) and shared with the map
  // footprint overlay so both read off a single WFS call.
  const viewport = useAtomValue(lidarViewportAtom);
  const extractViewerOpen = useAtomValue(lidarExtractViewerOpenAtom);

  // Fetch the full LiDAR project catalogue once (WMS GetCapabilities,
  // ~1900 rows, cached in localStorage for a week by fetchLidarProjects
  // itself) — feeds the cheap, always-on badge count below. The
  // viewport-scoped, coverage-confirmed list shown inside the popover
  // comes from lidarViewportAtom instead.
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

  // Style options for the national mosaic (per-project styles come from
  // activeLidarProject.styles directly, already in the catalogue).
  useEffect(() => {
    let cancelled = false;
    fetchNationalLidarStyles()
      .then((styles) => {
        if (!cancelled) setNationalStyles(styles);
      })
      .catch(() => {
        if (!cancelled) setNationalStyles([DEFAULT_LIDAR_PROJECT_STYLE]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Badge on the LiDAR button: how many catalogued projects intersect the
  // current viewport. Cheap (pure array filter over the already-loaded
  // catalogue, no network) so it runs continuously regardless of whether
  // LiDAR mode is even on — the amount of available data should be
  // discoverable before the user ever clicks in.
  const [relevantCount, setRelevantCount] = useState(0);
  useEffect(() => {
    if (!allProjects) return;
    const recompute = () => {
      const size = map.getSize();
      const center = map.getView().getCenter();
      if (!size || !center) return;
      const extent = map.getView().calculateExtent(size);
      const projection = map.getView().getProjection().getCode();
      const extentLonLat = transformExtent(extent, projection, 'EPSG:4326') as
        | [number, number, number, number]
        | undefined;
      if (!extentLonLat) return;
      setRelevantCount(
        allProjects.filter((p) => bboxIntersects(p.bboxLonLat, extentLonLat))
          .length,
      );
    };
    recompute();
    map.on('moveend', recompute);
    return () => {
      map.un('moveend', recompute);
    };
  }, [allProjects, map]);

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

  // Both activation paths clamp the style to what the target dataset
  // actually publishes (see resolveLidarStyle) — the national mosaic
  // publishes only skyggerelieff, so carrying e.g. helning_prosent over
  // from a project would render an empty background.
  const selectNational = () => {
    setBackgroundLayer('lidarHillshade');
    setActiveLidarStyle((prev) => resolveLidarStyle(nationalStyles, prev));
  };
  const selectProject = (p: LidarProject) => {
    setActiveLidarProject(p);
    setBackgroundLayer('lidarProject');
    setActiveLidarStyle((prev) => resolveLidarStyle(p.styles, prev));
  };
  // Clicking a row picks *and* dismisses; the keyboard path below picks
  // without closing, so you can watch the selection walk the open list.
  const activateNational = () => {
    selectNational();
    setLidarOpen(false);
  };
  const activateProject = (p: LidarProject) => {
    selectProject(p);
    setLidarOpen(false);
  };

  const renderProjectRow = (entry: LidarViewportEntry) => (
    <LidarPulldownItem
      key={entry.project.id}
      label={entry.project.projectName}
      meta={projectMeta(entry)}
      active={isLidarProject && activeLidarProject?.id === entry.project.id}
      onActivate={() => activateProject(entry.project)}
      onHover={(hovering) =>
        setHoveredLidarProjectId(hovering ? entry.project.id : null)
      }
    />
  );

  const isLidarProject = backgroundLayer === 'lidarProject';
  const isNationalMosaic = backgroundLayer === 'lidarHillshade';
  const isLidarMode = isLidarProject || isNationalMosaic;

  // Leaving LiDAR mode unmounts the pulldown without it ever firing
  // onOpenChange, so clear the shared flag by hand — otherwise the map
  // would draw footprints again the next time LiDAR is switched on.
  useEffect(() => {
    if (!isLidarMode) setLidarOpen(false);
  }, [isLidarMode, setLidarOpen]);

  const lidarChipLabel = isLidarProject && activeLidarProject
    ? activeLidarProject.projectName
    : 'Nasjonal mosaikk';

  const activeDatasetStyles =
    isLidarProject && activeLidarProject
      ? activeLidarProject.styles
      : nationalStyles;
  const tierAStyles = TIER_A_STYLES.filter((s) =>
    activeDatasetStyles.includes(s),
  );
  const tierBStyles = activeDatasetStyles.filter(
    (s) => !TIER_A_STYLES.includes(s),
  );
  const showStylePicker = activeDatasetStyles.length > 1;

  // Keyboard cycling: A/D steps the style pulldown, W/S the dataset
  // pulldown. Both walk the top tier only — the entries the pulldowns
  // show without expanding "flere lag" — and wrap at both ends. Reading
  // terrain means flipping the same handful of styles back and forth
  // over one spot; going via the mouse every time breaks that rhythm.
  //
  // Held through a ref rather than an effect dependency: the lists it
  // closes over are rebuilt on every render, so the alternative is
  // re-attaching the document listener continuously.
  const cycleRef = useRef<(key: string) => boolean>(() => false);
  cycleRef.current = (key: string): boolean => {
    // The extract viewer covers the map: swapping the background behind
    // it would be invisible and still cost a full round of WMS loads.
    if (!isLidarMode || extractViewerOpen) return false;
    const step = key === 'd' || key === 's' ? 1 : -1;

    if (key === 'a' || key === 'd') {
      if (tierAStyles.length === 0) return false;
      const at = tierAStyles.indexOf(activeLidarStyle);
      // A "flere stiler" entry is active and so isn't on this ring —
      // enter the ring from whichever end the key is heading towards.
      const from = at >= 0 ? at : step > 0 ? -1 : 0;
      setActiveLidarStyle(
        tierAStyles[(from + step + tierAStyles.length) % tierAStyles.length],
      );
      return true;
    }

    // The project ring is whatever the pulldown lists, and that list
    // only exists while the pulldown is open: the footprint WFS is
    // fetched on open and lidarViewportAtom is reset to 'idle' on close
    // (see lidarFootprintsLayer). So W/S opens the picker first and
    // starts walking once the fetch lands — cycling against an empty
    // list would just pin the selection to the national mosaic.
    if (!lidarOpen) {
      setLidarOpen(true);
      return true;
    }
    if (viewport.status !== 'ready') return true;

    // Index 0 is the national mosaic, then the primary projects — same
    // order the pulldown lists them in.
    const entries = viewport.primary;
    const ring = entries.length + 1;
    const at = entries.findIndex(
      (e) => e.project.id === activeLidarProject?.id,
    );
    const from = isNationalMosaic ? 0 : at >= 0 ? at + 1 : step > 0 ? -1 : 0;
    const next = (from + step + ring) % ring;
    if (next === 0) selectNational();
    else selectProject(entries[next - 1].project);
    return true;
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // e.repeat: a leaned-on key would otherwise queue a full WMS
      // reload per frame.
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== 'a' && key !== 'd' && key !== 'w' && key !== 's') return;
      if (cycleRef.current(key)) event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

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
        badge={relevantCount}
        onClick={() => {
          if (!isLidarMode) activateNational();
        }}
      />

      {/* LiDAR pulldown — only surfaces when LiDAR mode is active. Shows
          current selection and lets the user swap between the national
          mosaic and per-project datasets confirmed (by real WFS footprint
          polygon, see lidarFootprintsLayer.ts) to cover the viewport. */}
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
          <PopoverContent width="320px" p={0} borderRadius="lg">
          <PopoverArrow />
          <PopoverBody p={2}>
            <Stack gap={1}>
              <Flex align="center" justify="space-between" px={1}>
                <Text fontSize="10px" color="gray.500">
                  LiDAR-datasett · W/S
                </Text>
                <Tooltip content="Filter" positioning={{ placement: 'top' }}>
                  <IconButton
                    icon="tune"
                    aria-label="Filter"
                    size="xs"
                    variant="ghost"
                    onClick={() => setFilterOpen(!filterOpen)}
                  />
                </Tooltip>
              </Flex>

              {/* Closed by default — relevance rules only ever reprioritize
                  (primary vs "flere lag"), never hide data, so dialing
                  these back always reveals more of the same catalogue. */}
              {filterOpen && (
                <Box bg="gray.50" borderRadius="md" p={2} mb={1}>
                  <Stack gap={2}>
                    <Box>
                      <Text fontSize="xs" color="gray.700">
                        Vis som hovedliste fra år: {filters.minYear}
                      </Text>
                      <input
                        type="range"
                        min={2000}
                        max={CURRENT_YEAR}
                        value={filters.minYear}
                        onChange={(e) =>
                          setFilters({
                            ...filters,
                            minYear: Number(e.target.value),
                          })
                        }
                        style={{ width: '100%' }}
                      />
                    </Box>
                    <Switch
                      checked={filters.grandfatherDense}
                      onCheckedChange={(e) =>
                        setFilters({
                          ...filters,
                          grandfatherDense: e.checked,
                        })
                      }
                    >
                      <Text fontSize="xs">
                        Regn ≥5 pkt/m² som nytt nok
                      </Text>
                    </Switch>
                    <Box>
                      <Text fontSize="xs" color="gray.700">
                        Minste andel av synsfeltet:{' '}
                        {Math.round(filters.minAreaRatio * 100)}%
                      </Text>
                      <input
                        type="range"
                        min={0}
                        max={50}
                        step={5}
                        value={Math.round(filters.minAreaRatio * 100)}
                        onChange={(e) =>
                          setFilters({
                            ...filters,
                            minAreaRatio: Number(e.target.value) / 100,
                          })
                        }
                        style={{ width: '100%' }}
                      />
                    </Box>
                    {(filters.minYear !== DEFAULT_LIDAR_FILTERS.minYear ||
                      !filters.grandfatherDense ||
                      filters.minAreaRatio !==
                        DEFAULT_LIDAR_FILTERS.minAreaRatio) && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setFilters(DEFAULT_LIDAR_FILTERS)}
                      >
                        Tilbakestill filter
                      </Button>
                    )}
                  </Stack>
                </Box>
              )}

              <LidarPulldownItem
                label="Nasjonal mosaikk"
                meta="hele Norge"
                active={isNationalMosaic}
                onActivate={activateNational}
              />
              <Box
                borderTop="1px solid"
                borderColor="gray.200"
                my={1}
                mx={1}
              />
              <Text fontSize="10px" color="gray.500" px={2}>
                Prosjekter, mest dekning først. Hold over for omriss.
              </Text>
              {/* The list is the only part that grows without bound, so
                  it — not the whole popover — is what scrolls; the
                  header, filter panel and mosaic row stay put. */}
              <Box
                maxH="min(45vh, 300px)"
                overflowY="auto"
                onMouseLeave={() => setHoveredLidarProjectId(null)}
              >
                {/* 'idle' is reachable here for the tick between the
                    pulldown opening and the fetch effect starting. */}
                {(allProjects === null ||
                  viewport.status === 'loading' ||
                  viewport.status === 'idle') && (
                  <Flex align="center" gap={2} p={2}>
                    <Spinner size="xs" />
                    <Text fontSize="xs" color="gray.500">
                      {allProjects === null
                        ? 'Henter katalog…'
                        : 'Henter omriss…'}
                    </Text>
                  </Flex>
                )}
                {/* Coverage can't be answered for a whole-country
                    viewport — the boundary WFS times out rather than
                    replying, so say so instead of spinning into an empty
                    list. */}
                {viewport.status === 'zoomedOut' && (
                  <Text fontSize="xs" color="gray.500" px={2} py={1}>
                    Zoom inn for å se hvilke LiDAR-prosjekter som dekker
                    området.
                  </Text>
                )}
                {viewport.status === 'error' && (
                  <Text fontSize="xs" color="gray.500" px={2} py={1}>
                    Fikk ikke hentet prosjektomriss akkurat nå. Prøv igjen,
                    eller zoom litt inn.
                  </Text>
                )}
                {allProjects != null &&
                  viewport.status === 'ready' &&
                  viewport.primary.length === 0 &&
                  viewport.secondary.length === 0 && (
                    <Text fontSize="xs" color="gray.500" px={2} py={1}>
                      Ingen LiDAR-prosjekter dekker dette utsnittet. Bruk
                      nasjonal mosaikk, eller prøv et annet sted.
                    </Text>
                  )}
                {viewport.status === 'ready' &&
                  viewport.primary.map(renderProjectRow)}
                {viewport.status === 'ready' &&
                  viewport.secondary.length > 0 && (
                    <>
                      <LidarDisclosure
                        open={moreProjectsOpen}
                        label={`${viewport.secondary.length} mindre relevante`}
                        onToggle={() => setMoreProjectsOpen(!moreProjectsOpen)}
                      />
                      {moreProjectsOpen &&
                        viewport.secondary.map(renderProjectRow)}
                    </>
                  )}
              </Box>
            </Stack>
          </PopoverBody>
          </PopoverContent>
        </Popover>
      )}

      {/* Style pulldown — sits next to the dataset chip whenever the
          active dataset publishes more than one styled variant. Cycling
          skyggerelieff / multiskyggerelieff / helning_prosent is the
          fast path; anything else (helning_grader, ...) sits behind
          "flere lag" here too. */}
      {isLidarMode && showStylePicker && (
        <Popover
          open={styleOpen}
          onOpenChange={(e) => setStyleOpen(e.open)}
          positioning={{ placement: 'bottom-start', offset: { mainAxis: 8 } }}
        >
          <PopoverTrigger asChild>
            <Box position="relative" display="inline-block">
              <Button
                variant="secondary"
                colorPalette="green"
                size="sm"
                rightIcon="arrow_drop_down"
                maxW="180px"
                overflow="hidden"
              >
                <Text
                  fontSize="xs"
                  lineHeight="short"
                  whiteSpace="nowrap"
                  textOverflow="ellipsis"
                  overflow="hidden"
                >
                  {activeLidarStyle}
                </Text>
              </Button>
              <CountBadge value={activeDatasetStyles.length} />
            </Box>
          </PopoverTrigger>
          <PopoverContent width="220px" p={0} borderRadius="lg">
            <PopoverArrow />
            <PopoverBody p={2}>
              <Stack gap={1}>
                <Text fontSize="10px" color="gray.500" px={2}>
                  Visningsstil · A/D
                </Text>
                {tierAStyles.map((style) => (
                  <LidarPulldownItem
                    key={style}
                    label={style}
                    active={activeLidarStyle === style}
                    onActivate={() => {
                      setActiveLidarStyle(style);
                      setStyleOpen(false);
                    }}
                  />
                ))}
                {tierBStyles.length > 0 && (
                  <>
                    <LidarDisclosure
                      open={moreStylesOpen}
                      label={`${tierBStyles.length} flere stiler`}
                      onToggle={() => setMoreStylesOpen(!moreStylesOpen)}
                    />
                    {moreStylesOpen &&
                      tierBStyles.map((style) => (
                        <LidarPulldownItem
                          key={style}
                          label={style}
                          active={activeLidarStyle === style}
                          onActivate={() => {
                            setActiveLidarStyle(style);
                            setStyleOpen(false);
                          }}
                        />
                      ))}
                  </>
                )}
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

      <MeasurePopover />

      {/* Signed-in-only lokalitet controls. Hidden entirely for guests
          rather than shown-disabled — the AuthButton at the right is
          the discoverable path in. Drawing and LiDAR keeps happen inside
          a lokalitet's workspace, not from here. */}
      {isSignedIn && (
        <>
          <Box borderLeft="1px solid" borderColor="gray.200" h="36px" mx={1} />
          <ToolButton
            icon="bookmark"
            label={t('localities.topbar.myLocalities')}
            active={currentMapTool === 'localities'}
            onClick={() => toggleTool('localities')}
          />
          <ToolButton
            icon="add_location_alt"
            label={t('localities.topbar.newLocality')}
            active={creatingLocality}
            onClick={() => {
              setCreatingLocality(!creatingLocality);
              setCurrentMapTool(null);
            }}
          />
        </>
      )}

      <Box flex="1" minW={1} />
      <AuthButton />
    </Flex>
  );
};
