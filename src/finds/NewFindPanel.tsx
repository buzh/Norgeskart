import {
  Box,
  Button,
  Flex,
  HStack,
  Input,
  Stack,
  Text,
} from '@kvib/react';
import type { FeatureCollection } from 'geojson';
import { useAtomValue, useSetAtom } from 'jotai';
import { createEmpty, extend } from 'ol/extent';
import { GeoJSON } from 'ol/format';
import { transformExtent } from 'ol/proj';
import type { ChangeEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createFind, FindBbox, FindVisibility } from '../api/finds';
import { currentUserAtom } from '../auth/atoms';
import { DrawControls } from '../draw/drawControls/DrawControls';
import { getDrawLayer } from '../draw/drawControls/hooks/mapLayers';
import { getFeaturePropertiesForExport } from '../draw/utils/featureUtils';
import { mapAtom } from '../map/atoms';
import { mapToolAtom } from '../map/overlay/atoms';

// Reuses the existing drawLayer so the user gets every draw tool
// (freehand, polygon, line, point, text) verbatim — no separate
// annotation-mode duplication. Trade-off: if the user has an
// unsaved sketch from the plain "Draw" tool, opening Nytt objekt
// shows it. That's a feature — it means "save this sketch as a
// find" is one click.

const geoJson = new GeoJSON();

const serializeDrawLayer = (
  mapProjection: string,
): { featureCollection: FeatureCollection; bbox: FindBbox } | null => {
  const layer = getDrawLayer();
  const features = layer?.getSource()?.getFeatures() ?? [];
  if (features.length === 0) return null;

  // Match the export path so style + text overlays survive the round
  // trip through PB → findsLayer hydration.
  const cloned = features.map((f) => {
    const clone = f.clone();
    clone.setId(f.getId());
    const props = getFeaturePropertiesForExport(f);
    if (props) clone.setProperties(props, true);
    return clone;
  });

  const geoJsonString = geoJson.writeFeatures(cloned, {
    dataProjection: 'EPSG:4326',
    featureProjection: mapProjection,
  });
  const featureCollection = JSON.parse(geoJsonString) as FeatureCollection;

  // Bbox in map projection first, then transform to 4326 for storage.
  const extent = createEmpty();
  for (const f of features) {
    const g = f.getGeometry();
    if (!g) continue;
    extend(extent, g.getExtent());
  }
  const [minX, minY, maxX, maxY] = transformExtent(
    extent,
    mapProjection,
    'EPSG:4326',
  );
  const bbox: FindBbox = [minX, minY, maxX, maxY];

  return { featureCollection, bbox };
};

export const NewFindPanel = () => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const map = useAtomValue(mapAtom);
  const closePanel = useSetAtom(mapToolAtom);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<FindVisibility>('private');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return (
      <Text fontSize="sm" color="gray.600">
        {t('finds.newFind.signInPrompt')}
      </Text>
    );
  }

  const canSave = title.trim().length > 0 && !saving;

  const onSave = async () => {
    setError(null);
    const projection = map.getView().getProjection().getCode();
    const payload = serializeDrawLayer(projection);
    if (!payload) {
      setError(t('finds.newFind.errors.noGeometry'));
      return;
    }
    setSaving(true);
    try {
      await createFind(
        {
          title: title.trim(),
          description: description.trim() || undefined,
          visibility,
          geometry: payload.featureCollection,
          bbox: payload.bbox,
        },
        user.id,
      );
      // Clear the draw layer so the user isn't confused about "did it
      // save?" — the persisted find will re-render from findsLayer's
      // realtime subscription in a moment.
      getDrawLayer()?.getSource()?.clear();
      closePanel(null);
    } catch (e) {
      console.warn('[NewFindPanel] save failed', e);
      setError(t('finds.newFind.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap={3}>
      <Text fontSize="xs" color="gray.600">
        {t('finds.newFind.instructions')}
      </Text>

      {/* Full draw toolbar. Owning this here rather than requiring the
          user to also open the standalone "Draw" panel keeps Nytt
          objekt self-contained. */}
      <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" p={2}>
        <DrawControls />
      </Box>

      <Stack gap={1}>
        <Text fontSize="xs" fontWeight="semibold">
          {t('finds.newFind.form.title')}
        </Text>
        <Input
          size="sm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('finds.newFind.form.titlePlaceholder')}
          maxLength={200}
        />
      </Stack>

      <Stack gap={1}>
        <Text fontSize="xs" fontWeight="semibold">
          {t('finds.newFind.form.description')}
        </Text>
        {/* Native textarea rather than a KVIB primitive — the surface
            of @kvib/react's textarea export isn't visible from this
            repo (no local node_modules) and the styling is simple
            enough that raw HTML + a Box wrapper stays consistent. */}
        <Box
          as="textarea"
          value={description}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
            setDescription(e.target.value)
          }
          placeholder={t('finds.newFind.form.descriptionPlaceholder')}
          rows={3}
          maxLength={20000}
          w="100%"
          px={2}
          py={1}
          fontSize="sm"
          borderWidth="1px"
          borderColor="gray.300"
          borderRadius="md"
          resize="vertical"
        />
      </Stack>

      <Stack gap={1}>
        <Text fontSize="xs" fontWeight="semibold">
          {t('finds.newFind.form.visibility')}
        </Text>
        <Box
          as="select"
          value={visibility}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            setVisibility(e.target.value as FindVisibility)
          }
          w="100%"
          px={2}
          py={1}
          fontSize="sm"
          borderWidth="1px"
          borderColor="gray.300"
          borderRadius="md"
          bg="white"
        >
          <option value="private">{t('finds.visibility.private')}</option>
          <option value="limited">{t('finds.visibility.limited')}</option>
          <option value="public">{t('finds.visibility.public')}</option>
        </Box>
        {visibility === 'limited' && (
          <Text fontSize="xs" color="gray.500">
            {t('finds.visibility.limitedHint')}
          </Text>
        )}
      </Stack>

      {error && (
        <Text fontSize="xs" color="red.600">
          {error}
        </Text>
      )}

      <Flex justify="flex-end">
        <HStack>
          <Button size="sm" variant="tertiary" onClick={() => closePanel(null)}>
            {t('finds.newFind.actions.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            colorPalette="green"
            onClick={onSave}
            disabled={!canSave}
          >
            {saving
              ? t('finds.newFind.actions.saving')
              : t('finds.newFind.actions.save')}
          </Button>
        </HStack>
      </Flex>
    </Stack>
  );
};
