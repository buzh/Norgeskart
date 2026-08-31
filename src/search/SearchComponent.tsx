import { Flex } from '@kvib/react';
import React, { useState } from 'react';
import { ErrorBoundary } from '../shared/ErrorBoundary.tsx';
import { SearchResult } from '../types/searchTypes.ts';
import { SearchResults } from './results/SearchResults.tsx';

// Search *input* now lives in the TopBar. This component renders only
// the results panel that floats under the top bar in Layout's left
// column overlay.
export const SearchComponent = () => {
  const [hoveredResult, setHoveredResult] = useState<SearchResult | null>(null);

  return (
    <ErrorBoundary fallback={undefined} name={React.Component.name}>
      <Flex flexDir="column" pointerEvents="auto" maxH="100%" overflowY="auto">
        <SearchResults
          hoveredResult={hoveredResult}
          setHoveredResult={setHoveredResult}
        />
      </Flex>
    </ErrorBoundary>
  );
};
