import { getDefaultStore, useSetAtom } from 'jotai';
import { Feature, MapBrowserEvent } from 'ol';
import BaseEvent from 'ol/events/Event';
import { Geometry } from 'ol/geom';
import { useCallback, useEffect } from 'react';
import { mapAtom } from '../map/atoms';
import { hasVisibleLayerWithIdIn } from '../map/featureInfo/featureInfoService';
import { CULTURAL_HERITAGE_LAYER_IDS } from '../map/layers/config/themeLayers/culturalHeritage';
import { mapToolAtom } from '../map/overlay/atoms';
import { ProjectionIdentifier } from '../map/projections/types';
import { ParsedCoordinate } from '../shared/utils/coordinateParser';
import { SearchResult } from '../types/searchTypes';
import { searchCoordinatesAtom, selectedResultAtom } from './atoms';
import { updateSearchMarkers } from './searchmarkers/updateSearchMarkers';

export const useMapClickSearch = () => {
  const setSearchCoordinates = useSetAtom(searchCoordinatesAtom);
  const setSelectedResult = useSetAtom(selectedResultAtom);
  //I hate this function
  const isClusterClick = useCallback((e: MapBrowserEvent): boolean => {
    const map = getDefaultStore().get(mapAtom);
    const features = map.getFeaturesAtPixel(e.pixel);
    // Check if the click is on a cluster
    const isCluster =
      features &&
      features.length === 1 &&
      features[0].get('features') &&
      Array.isArray(features[0].get('features')) &&
      features[0].get('features').length > 1;

    const hasMarkerFeature =
      features &&
      features.some((f) => {
        return f.get('features')?.some((ff: Feature<Geometry>) => {
          return ff.get('isMarker') === true;
        });
      });

    return isCluster || hasMarkerFeature;
  }, []);

  const handlePositionClick = useCallback(
    (e: MapBrowserEvent) => {
      const map = getDefaultStore().get(mapAtom);
      const coordinate = e.coordinate;
      const projection = map.getView().getProjection().getCode();
      setSearchCoordinates({
        x: coordinate[0],
        y: coordinate[1],
        projection: projection as ProjectionIdentifier,
      });

      const parsedCoordinate: ParsedCoordinate = {
        lat: coordinate[0],
        lon: coordinate[1],
        projection: projection as ProjectionIdentifier,
        formattedString: `${coordinate[0].toFixed(2)}, ${coordinate[1].toFixed(2)} @ ${projection.split(':')[1]}`,
        inputFormat: 'utm',
      };
      const coordinateResult: SearchResult = {
        lon: coordinate[0],
        lat: coordinate[1],
        name: parsedCoordinate.formattedString,
        type: 'Coordinate',
        coordinate: parsedCoordinate,
      };

      setSelectedResult(coordinateResult);

      updateSearchMarkers([], null, coordinateResult, () => {});
    },
    [setSearchCoordinates, setSelectedResult],
  );

  const mapClickHandler = useCallback(
    (e: Event | BaseEvent) => {
      const store = getDefaultStore();
      const currentTool = store.get(mapToolAtom);
      if (currentTool && currentTool !== 'layers') {
        return;
      }

      if (currentTool === 'layers') {
        store.set(mapToolAtom, null);
      }
      if (e instanceof MapBrowserEvent) {
        const isClickClusterClick = isClusterClick(e);

        if (isClickClusterClick) {
          return;
        }
        // If a kulturminner layer is visible, useFeatureInfoClick owns the
        // click result — it may open the compact popup and doesn't want the
        // coordinate InfoBox flashing in first. It will fall back to setting
        // selectedResult itself when the click misses every kulturminner.
        const map = getDefaultStore().get(mapAtom);
        if (hasVisibleLayerWithIdIn(map, CULTURAL_HERITAGE_LAYER_IDS)) {
          return;
        }
        handlePositionClick(e);
      }
    },
    [handlePositionClick, isClusterClick],
  );
  useEffect(() => {
    const map = getDefaultStore().get(mapAtom);
    map.addEventListener('click', mapClickHandler);
    return () => {
      map.removeEventListener('click', mapClickHandler);
    };
  }, [mapClickHandler]);
};
