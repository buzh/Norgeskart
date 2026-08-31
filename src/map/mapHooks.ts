import { useAtomValue } from 'jotai';
import { get as getProjection, transform } from 'ol/proj';
import { useCallback } from 'react';
import { setUrlParameter } from '../shared/utils/urlUtils';
import { mapAtom } from './atoms';
import { ProjectionIdentifier } from './projections/types';

const useMap = () => {
  const map = useAtomValue(mapAtom);

  const setTargetElement = useCallback(
    (element: HTMLDivElement | null) => {
      if (!map.getTarget() && element) {
        map.setTarget(element);
      } else if (element == null) {
        map.setTarget(undefined);
      }
    },
    [map],
  );

  const mapElement = map.getTarget() as HTMLElement | undefined;
  return { mapElement, setTargetElement };
};

const useMapSettings = () => {
  const map = useAtomValue(mapAtom);

  const getMapViewCenter = () => {
    const view = map.getView();
    return view.getCenter();
  };

  const getMapProjection = () => {
    return map.getView().getProjection();
  };

  const getMapProjectionCode = () => {
    return getMapProjection().getCode() as ProjectionIdentifier;
  };

  const setMapFullScreen = (shouldBeFullscreen: boolean) => {
    if (!document.fullscreenEnabled) {
      return;
    }
    const mapElement = map.getTarget() as HTMLElement | undefined;
    if (!mapElement) {
      return;
    }
    if (shouldBeFullscreen) {
      mapElement
        .requestFullscreen()
        .catch((err) =>
          console.error('Error attempting to enable full-screen mode:', err),
        );
    } else {
      document.exitFullscreen();
    }
  };

  const setMapLocation = (
    location: [number, number],
    locationProjection: string | null = null,
    zoomLevel: number | null = null,
  ) => {
    const currentMapProjection = map.getView().getProjection();
    const sourceProjection = getProjection(
      locationProjection || currentMapProjection.getCode(),
    );
    if (!sourceProjection) {
      console.error(`Projection ${locationProjection} not found`);
      return;
    }
    const transformedLocation = transform(
      location,
      sourceProjection,
      map.getView().getProjection(),
    );
    map.getView().setCenter(transformedLocation);
    if (zoomLevel !== null) {
      map.getView().setZoom(zoomLevel);
    }
    setUrlParameter('lon', transformedLocation[0]);
    setUrlParameter('lat', transformedLocation[1]);
  };

  return {
    getMapProjection,
    getMapProjectionCode,
    getMapViewCenter,
    setMapFullScreen,
    setMapLocation,
  };
};

export { useMap, useMapSettings };
