import { Box, Text } from '@kvib/react';
import { useAtom } from 'jotai';
import 'ol/ol.css';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from '../shared/ErrorBoundary.tsx';
import { projectionEffect } from './atoms.ts';
import { trackPostitionAtomEffect } from './geolocation/atoms.ts';
import { themeLayerEffect } from './layers/atoms.ts';
import { backgroundLayerAtomEffect } from './layers/config/backgroundLayers/atoms.ts';
import { useMap } from './mapHooks.ts';

export const MapComponent = () => {
  const mapRef = useRef<HTMLDivElement>(null);

  const { t } = useTranslation();
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
