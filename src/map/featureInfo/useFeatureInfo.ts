import { getDefaultStore, useAtomValue, useSetAtom } from 'jotai';
import { MapBrowserEvent } from 'ol';
import BaseEvent from 'ol/events/Event';
import { useCallback, useEffect } from 'react';
import { selectedResultAtom } from '../../search/atoms';
import { ParsedCoordinate } from '../../shared/utils/coordinateParser';
import { SearchResult } from '../../types/searchTypes';
import { mapAtom } from '../atoms';
import { CULTURAL_HERITAGE_LAYER_IDS } from '../layers/config/themeLayers/culturalHeritage';
import { ProjectionIdentifier } from '../projections/types';
import {
  featureInfoLoadingAtom,
  featureInfoPanelOpenAtom,
  featureInfoResultAtom,
  kulturminnerPopupAtom,
} from './atoms';
import {
  fetchAllFeatureInfo,
  getVisibleVectorLayers,
  hasVisibleLayerWithIdIn,
  hasVisibleQueryableLayers,
} from './featureInfoService';

export const buildCoordinateResult = (
  coordinate: [number, number],
  projection: ProjectionIdentifier,
): SearchResult => {
  const parsed: ParsedCoordinate = {
    lat: coordinate[0],
    lon: coordinate[1],
    projection,
    formattedString: `${coordinate[0].toFixed(2)}, ${coordinate[1].toFixed(2)} @ ${projection.split(':')[1]}`,
    inputFormat: 'utm',
  };
  return {
    lon: coordinate[0],
    lat: coordinate[1],
    name: parsed.formattedString,
    type: 'Coordinate',
    coordinate: parsed,
  };
};

export const useFeatureInfoClick = () => {
  const setFeatureInfoResult = useSetAtom(featureInfoResultAtom);
  const setFeatureInfoLoading = useSetAtom(featureInfoLoadingAtom);
  const setFeatureInfoPanelOpen = useSetAtom(featureInfoPanelOpenAtom);
  const setKulturminnerPopup = useSetAtom(kulturminnerPopupAtom);
  const setSelectedResult = useSetAtom(selectedResultAtom);

  const handleMapClick = useCallback(
    async (e: Event | BaseEvent) => {
      const map = getDefaultStore().get(mapAtom);
      const contextMenuOpen = document.querySelector(
        '[data-context-menu-open]',
      );
      if (contextMenuOpen) {
        return;
      }

      if (!(e instanceof MapBrowserEvent)) {
        return;
      }

      setKulturminnerPopup(null);

      const hasWmsLayers = hasVisibleQueryableLayers(map);
      const hasVectorLayers = getVisibleVectorLayers(map).length > 0;
      const heritageLayerVisible = hasVisibleLayerWithIdIn(
        map,
        CULTURAL_HERITAGE_LAYER_IDS,
      );

      if (!hasWmsLayers && !hasVectorLayers) {
        setFeatureInfoPanelOpen(false);
        return;
      }

      const coordinate = e.coordinate as [number, number];
      const pixel = e.pixel as [number, number];
      const projection = map
        .getView()
        .getProjection()
        .getCode() as ProjectionIdentifier;

      setFeatureInfoLoading(true);

      try {
        const result = await fetchAllFeatureInfo(map, coordinate, pixel);

        setFeatureInfoResult(result);

        const heritageLayers = result.layers.filter(
          (l) =>
            CULTURAL_HERITAGE_LAYER_IDS.has(l.layerId) && l.features.length > 0,
        );

        if (heritageLayers.length > 0) {
          // Kulturminner click: show the floating compact popup instead of
          // the coordinate InfoBox. "Vis mer" in the popup opens the InfoBox
          // for the full accordion.
          setKulturminnerPopup({ coordinate, layers: heritageLayers });
          setSelectedResult(null);
          setFeatureInfoPanelOpen(false);
        } else {
          // Kulturminner layer was visible so useMapClickSearch skipped its
          // usual setSelectedResult; do it here now that we know no heritage
          // POI was actually hit.
          if (heritageLayerVisible) {
            setSelectedResult(buildCoordinateResult(coordinate, projection));
          }
          setFeatureInfoPanelOpen(result.layers.length > 0);
        }
      } catch (error) {
        console.error('Error fetching feature info:', error);
        setFeatureInfoResult(null);
        setFeatureInfoPanelOpen(false);
        if (heritageLayerVisible) {
          setSelectedResult(buildCoordinateResult(coordinate, projection));
        }
      } finally {
        setFeatureInfoLoading(false);
      }
    },
    [
      setFeatureInfoResult,
      setFeatureInfoLoading,
      setFeatureInfoPanelOpen,
      setKulturminnerPopup,
      setSelectedResult,
    ],
  );

  useEffect(() => {
    const map = getDefaultStore().get(mapAtom);
    map.on('singleclick', handleMapClick);
    return () => {
      map.un('singleclick', handleMapClick);
    };
  }, [handleMapClick]);

  const closeFeatureInfoPanel = useCallback(() => {
    setFeatureInfoPanelOpen(false);
  }, [setFeatureInfoPanelOpen]);

  const clearFeatureInfo = useCallback(() => {
    setFeatureInfoResult(null);
    setFeatureInfoPanelOpen(false);
  }, [setFeatureInfoResult, setFeatureInfoPanelOpen]);

  return {
    closeFeatureInfoPanel,
    clearFeatureInfo,
  };
};

export const useFeatureInfo = () => {
  const featureInfoResult = useAtomValue(featureInfoResultAtom);
  const featureInfoLoading = useAtomValue(featureInfoLoadingAtom);
  const featureInfoPanelOpen = useAtomValue(featureInfoPanelOpenAtom);
  const setFeatureInfoPanelOpen = useSetAtom(featureInfoPanelOpenAtom);

  const closePanel = useCallback(() => {
    setFeatureInfoPanelOpen(false);
  }, [setFeatureInfoPanelOpen]);

  return {
    result: featureInfoResult,
    loading: featureInfoLoading,
    panelOpen: featureInfoPanelOpen,
    closePanel,
  };
};
