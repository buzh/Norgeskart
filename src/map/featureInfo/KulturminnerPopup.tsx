import { Badge, Box, Button, Flex, IconButton, Stack, Text } from '@kvib/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Overlay } from 'ol';
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { selectedResultAtom } from '../../search/atoms';
import { mapAtom } from '../atoms';
import { ProjectionIdentifier } from '../projections/types';
import { kulturminnerPopupAtom } from './atoms';
import type { FeatureInfoFeature, LayerFeatureInfo } from './types';
import { buildCoordinateResult } from './useFeatureInfo';

// Field-name substrings ordered by priority for the compact view.
// First match wins for each priority slot; unknown fields are hidden.
const PRIORITY_FIELDS = [
  { key: 'navn', label: 'Navn' },
  { key: 'kategori', label: 'Kategori' },
  { key: 'art', label: 'Art' },
  { key: 'datering', label: 'Datering' },
  { key: 'vernetype', label: 'Vernetype' },
  { key: 'vernestatus', label: 'Vernestatus' },
  { key: 'status', label: 'Status' },
  { key: 'kommune', label: 'Kommune' },
];

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nei';
  return String(value);
};

const getPriorityEntries = (
  feature: FeatureInfoFeature,
): Array<{ label: string; value: string }> => {
  const props = feature.properties;
  const propKeys = Object.keys(props);
  const lookup = new Map(propKeys.map((k) => [k.toLowerCase(), k]));
  const seen = new Set<string>();
  const out: Array<{ label: string; value: string }> = [];

  for (const { key, label } of PRIORITY_FIELDS) {
    if (seen.has(label)) continue;
    const matchKey = Array.from(lookup.keys()).find((k) => k.includes(key));
    if (!matchKey) continue;
    const originalKey = lookup.get(matchKey)!;
    const value = props[originalKey];
    if (value === null || value === undefined || value === '') continue;
    out.push({ label, value: formatValue(value) });
    seen.add(label);
  }
  return out;
};

const getIdentifier = (feature: FeatureInfoFeature): string | undefined => {
  const props = feature.properties;
  const idKeys = ['kulturminneid', 'lokalid', 'objid'];
  for (const key of idKeys) {
    const match = Object.keys(props).find((k) => k.toLowerCase() === key);
    if (match) {
      const v = props[match];
      if (v !== null && v !== undefined && v !== '') return String(v);
    }
  }
  return feature.id;
};

const FeatureBlock = ({
  layerTitle,
  feature,
  showLayerBadge,
}: {
  layerTitle: string;
  feature: FeatureInfoFeature;
  showLayerBadge: boolean;
}) => {
  const entries = getPriorityEntries(feature);
  const identifier = getIdentifier(feature);

  return (
    <Box>
      <Flex align="center" gap={2} mb={1}>
        {showLayerBadge && (
          <Badge colorPalette="blue" size="sm">
            {layerTitle}
          </Badge>
        )}
        {identifier && (
          <Text fontSize="xs" color="gray.500">
            #{identifier}
          </Text>
        )}
      </Flex>
      {entries.length === 0 ? (
        <Text fontSize="sm" color="gray.500">
          Ingen fremhevet informasjon
        </Text>
      ) : (
        <Stack gap={0.5}>
          {entries.map(({ label, value }) => (
            <Flex key={label} gap={2} fontSize="sm">
              <Text color="gray.600" fontWeight="medium" minW="80px">
                {label}
              </Text>
              <Text>{value}</Text>
            </Flex>
          ))}
        </Stack>
      )}
    </Box>
  );
};

const PopupContent = ({
  layers,
  onClose,
  onShowMore,
}: {
  layers: LayerFeatureInfo[];
  onClose: () => void;
  onShowMore: () => void;
}) => {
  const totalFeatures = layers.reduce((n, l) => n + l.features.length, 0);
  const showLayerBadge = layers.length > 1;

  return (
    <Box
      bg="white"
      borderRadius="12px"
      boxShadow="0 4px 12px rgba(0,0,0,0.2)"
      p={3}
      w="300px"
      maxH="60vh"
      overflowY="auto"
      pointerEvents="auto"
    >
      <Flex justify="space-between" align="center" mb={2}>
        <Text fontWeight="bold" fontSize="sm">
          Kulturminne
          {totalFeatures > 1 ? ` (${totalFeatures})` : ''}
        </Text>
        <IconButton
          onClick={onClose}
          icon="close"
          variant="ghost"
          size="xs"
          aria-label="Lukk"
        />
      </Flex>
      <Stack gap={3}>
        {layers.flatMap((layer, li) =>
          layer.features.map((feature, fi) => (
            <FeatureBlock
              key={`${li}-${fi}`}
              layerTitle={layer.layerTitle}
              feature={feature}
              showLayerBadge={showLayerBadge}
            />
          )),
        )}
      </Stack>
      <Button
        onClick={onShowMore}
        variant="tertiary"
        size="sm"
        mt={3}
        w="full"
      >
        Vis mer
      </Button>
    </Box>
  );
};

export const KulturminnerPopup = () => {
  const popup = useAtomValue(kulturminnerPopupAtom);
  const setPopup = useSetAtom(kulturminnerPopupAtom);
  const setSelectedResult = useSetAtom(selectedResultAtom);
  const map = useAtomValue(mapAtom);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<Overlay | null>(null);

  if (!containerRef.current) {
    const el = document.createElement('div');
    el.style.pointerEvents = 'none';
    containerRef.current = el;
  }

  useEffect(() => {
    if (!map || !containerRef.current) return;
    const overlay = new Overlay({
      element: containerRef.current,
      positioning: 'bottom-center',
      offset: [0, -16],
      stopEvent: true,
      autoPan: { animation: { duration: 200 } },
    });
    overlayRef.current = overlay;
    map.addOverlay(overlay);
    return () => {
      map.removeOverlay(overlay);
      overlayRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    overlayRef.current?.setPosition(popup?.coordinate);
  }, [popup]);

  const handleShowMore = useCallback(() => {
    if (!popup) return;
    const projection = map
      .getView()
      .getProjection()
      .getCode() as ProjectionIdentifier;
    setSelectedResult(buildCoordinateResult(popup.coordinate, projection));
    setPopup(null);
  }, [popup, map, setSelectedResult, setPopup]);

  if (!popup || !containerRef.current) return null;

  return createPortal(
    <PopupContent
      layers={popup.layers}
      onClose={() => setPopup(null)}
      onShowMore={handleShowMore}
    />,
    containerRef.current,
  );
};
