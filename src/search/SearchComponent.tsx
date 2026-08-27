import {
  Box,
  Flex,
  Icon,
  IconButton,
  Search,
  Spinner,
  Text,
} from '@kvib/react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MapLayerPicker } from '../map/backgroundLayer/MapLayerPicker.tsx';
import { ErrorBoundary } from '../shared/ErrorBoundary.tsx';
import { SearchResult } from '../types/searchTypes.ts';
import {
  allSearchResultsAtom,
  displaySearchResultsAtom,
  searchPendingAtom,
  searchQueryAtom,
  useResetSearchResults,
} from './atoms.ts';
import { SearchResults } from './results/SearchResults.tsx';

const SearchIcon = () => {
  const searchQuery = useAtomValue(searchQueryAtom);
  const isSearchPending = useAtomValue(searchPendingAtom);
  const resetSearchResults = useResetSearchResults();
  const allResults = useAtomValue(allSearchResultsAtom);
  if (isSearchPending) {
    return <Spinner />;
  }
  if (allResults.length > 0 || searchQuery !== '') {
    return (
      <IconButton
        icon="close"
        variant="ghost"
        color={'gray'}
        size={24}
        onClick={resetSearchResults}
      />
    );
  }
  if (searchQuery === '') {
    return <Icon icon="search" size={24} weight={500} color="gray" />;
  }
};

export const SearchComponent = () => {
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
  const [hoveredResult, setHoveredResult] = useState<SearchResult | null>(null);
  const [showLayerPicker, setShowLayerPicker] = useState(false);
  const { t } = useTranslation();
  const setDisplaySearchResults = useSetAtom(displaySearchResultsAtom);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setHoveredResult(null);
    setShowLayerPicker(false);
  };

  return (
    <ErrorBoundary fallback={undefined} name={React.Component.name}>
      <Flex
        flexDir="column"
        alignItems="stretch"
        gap={2}
        pointerEvents={'auto'}
        px={3}
        pt={3}
        maxH={'100%'}
        overflowY={'auto'}
        maxW={'450px'}
      >
        {/* TOPP: kart-flis + søkefelt */}
        <Box backgroundColor="#FFFF" p={2} borderRadius={10}>
          <Flex alignItems="center" gap={2}>
            {/* Kart-flis til venstre */}

            <IconButton
              display={{ md: 'none' }}
              icon="layers"
              variant="tertiary"
              aria-label={t('search.backgroundChooser.label')}
              onClick={() => {
                setShowLayerPicker((s) => !s);
              }}
            />
            <Box position="relative" width="100%">
              <Search
                autoFocus
                width="100%"
                placeholder={t('search.placeholder')}
                value={searchQuery}
                onChange={handleChange}
                height="45px"
                fontSize="1.1rem"
                bg="white"
                maxLength={100}
                onClick={() => {
                  setDisplaySearchResults(true);
                }}
              />
              <Box
                position="absolute"
                right="10px"
                top="50%"
                transform="translateY(-50%)"
              >
                <SearchIcon />
              </Box>
              {searchQuery.length >= 100 && (
                <Text fontSize="xs" color="red.500" mt={1}>
                  {t('search.maxLength')}
                </Text>
              )}
            </Box>
          </Flex>
        </Box>
        <SearchResults
          hoveredResult={hoveredResult}
          setHoveredResult={setHoveredResult}
        />
        {showLayerPicker && (
          <Box display={{ md: 'none' }}>
            <MapLayerPicker />
          </Box>
        )}
      </Flex>
    </ErrorBoundary>
  );
};
