import { Box, Text } from '@kvib/react';
import { useAtom, useAtomValue } from 'jotai';
import 'ol/ol.css';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getFeatures } from '../api/nkApiClient.ts';
import { useDrawSettings } from '../draw/drawControls/hooks/drawSettings.ts';
import { ErrorBoundary } from '../shared/ErrorBoundary.tsx';
import { getUrlParameter } from '../shared/utils/urlUtils.ts';
import { mapAtom, projectionEffect } from './atoms.ts';
import { trackPostitionAtomEffect } from './geolocation/atoms.ts';
import { themeLayerEffect } from './layers/atoms.ts';
import { backgroundLayerAtomEffect } from './layers/config/backgroundLayers/atoms.ts';
import { useMap } from './mapHooks.ts';

export const MapComponent = () => {
  const mapRef = useRef<HTMLDivElement>(null);

  const map = useAtomValue(mapAtom);
  const { t } = useTranslation();
  const { setDrawLayerFeatures } = useDrawSettings();
  const hasLoadedDrawingRef = useRef(false);
  const { setTargetElement } = useMap();
  useAtom(themeLayerEffect);
  useAtom(trackPostitionAtomEffect);
  useAtom(projectionEffect);
  useAtom(backgroundLayerAtomEffect);

  useEffect(() => {
    if (mapRef.current) {
      setTargetElement(mapRef.current);
    }
    return () => {
      setTargetElement(null);
    };
  }, [setTargetElement, mapRef]);

  useEffect(() => {
    if (hasLoadedDrawingRef.current) {
      return;
    }
    const asyncEffect = async () => {
      const drawingId = getUrlParameter('drawing');
      if (drawingId) {
        const features = await getFeatures(drawingId);
        if (!features) {
          console.warn(`No features found for drawing id: ${drawingId}`);
          return;
        }
        setDrawLayerFeatures(features, 'EPSG:4326');
        hasLoadedDrawingRef.current = true;
      }
    };
    asyncEffect();
  }, [map, setDrawLayerFeatures]);

  return (
    <Box position={'relative'} width="100%" height="100%">
      <ErrorBoundary fallback={<Text>{t('map.errorMessage')}</Text>}>
        <Box
          ref={mapRef}
          id="map"
          style={{ width: '100%', height: '100%' }}
        />
      </ErrorBoundary>
    </Box>
  );
};
