import { Box, Flex } from '@kvib/react';
import { useAtomValue } from 'jotai';
import { BottomDrawToolSelector } from './draw/BottomDrawToolSelector';
import { KulturminnerPopup } from './map/featureInfo/KulturminnerPopup';
import { useFeatureInfoClick } from './map/featureInfo/useFeatureInfo';
import { MapComponent } from './map/MapComponent';
import { mapToolAtom } from './map/overlay/atoms';
import { MapToolCards } from './map/overlay/MapToolCards';
import { useSearchEffects } from './search/atoms';
import { useMapClickSearch } from './search/hooks';
import { InfoBox } from './search/infobox/InfoBox';
import { SearchComponent } from './search/SearchComponent';
import { ErrorBoundary } from './shared/ErrorBoundary';
import { useIsMobileScreen } from './shared/hooks';
import { TopBar } from './TopBar';

// Values referenced by the mapToolAtom in map/overlay/atoms.ts and by the
// tool-card renderer in map/overlay/MapToolCards.tsx. Kept in this file
// so any TopBar / other module that toggles the atom uses the same type.
export type MapTool = 'layers' | 'draw' | 'measure' | 'lidarExtract' | null;

export const Layout = () => {
  const isMobile = useIsMobileScreen();
  const currentMapTool = useAtomValue(mapToolAtom);

  useFeatureInfoClick();
  useSearchEffects();
  useMapClickSearch();

  return (
    <ErrorBoundary fallback={undefined}>
      <Flex
        flexDir="column"
        h="100dvh"
        w="100dvw"
        bg="gray.200"
        overflow="hidden"
      >
        <ErrorBoundary fallback={undefined} name="TopBar">
          <TopBar />
        </ErrorBoundary>

        <Box flex="1" position="relative" overflow="hidden">
          <ErrorBoundary fallback={undefined} name="MapComponent">
            <MapComponent />
          </ErrorBoundary>

          {/* Left column: search results + any tool card that opens as a
              panel (Kartlag / Draw / LiDAR extract). Absolute-positioned
              so it floats over the map. */}
          <Box
            position="absolute"
            top={0}
            left={0}
            bottom={0}
            w={{ base: '100%', md: '360px', lg: '400px' }}
            maxW="100%"
            pt={3}
            pl={3}
            pb={3}
            pointerEvents="none"
            zIndex={2}
            overflowY="auto"
          >
            <ErrorBoundary fallback={undefined} name="SearchComponent">
              <SearchComponent />
            </ErrorBoundary>
            <ErrorBoundary fallback={undefined} name="MapToolCards">
              <MapToolCards />
            </ErrorBoundary>
          </Box>

          {/* Right column: coordinate-info / search-result infobox */}
          <Box
            position="absolute"
            top={0}
            right={0}
            pt={3}
            pr={3}
            pointerEvents="none"
            zIndex={2}
          >
            <Flex justifyContent="flex-end">
              <ErrorBoundary fallback={undefined} name="InfoBox">
                <InfoBox />
              </ErrorBoundary>
            </Flex>
          </Box>
        </Box>
      </Flex>

      {isMobile && currentMapTool === 'draw' && (
        <ErrorBoundary fallback={undefined} name="BottomDrawToolSelector">
          <BottomDrawToolSelector />
        </ErrorBoundary>
      )}
      <ErrorBoundary fallback={undefined} name="KulturminnerPopup">
        <KulturminnerPopup />
      </ErrorBoundary>
    </ErrorBoundary>
  );
};
