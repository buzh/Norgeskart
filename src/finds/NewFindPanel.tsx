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
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { createEmpty, extend } from 'ol/extent';
import { GeoJSON } from 'ol/format';
import { Circle as CircleGeom } from 'ol/geom';
import { fromCircle } from 'ol/geom/Polygon';
import { transformExtent } from 'ol/proj';
import type { ChangeEvent, CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createFind,
  FindBbox,
  FindRecord,
  FindVisibility,
  updateFind,
} from '../api/finds';
import { currentUserAtom } from '../auth/atoms';
import { DrawControls } from '../draw/drawControls/DrawControls';
import { useDrawSettings } from '../draw/drawControls/hooks/drawSettings';
import { getDrawLayer } from '../draw/drawControls/hooks/mapLayers';
import { getFeaturePropertiesForExport } from '../draw/utils/featureUtils';
import { mapAtom } from '../map/atoms';
import { mapToolAtom } from '../map/overlay/atoms';
import { pb } from '../api/pocketbase';
import { editingFindIdAtom } from './atoms';
import {
  FIND_ID_PROPERTY,
  getFindsLayer,
  setFindHiddenOnLayer,
  upsertFindOnLayer,
} from './findsLayer';

// Reuses the shared draw layer so the user gets every draw tool
// (freehand, polygon, line, point, text) verbatim — no annotation-mode
// duplication. In edit mode we seed the layer with the find's saved
// features and reveal them via the normal draw UI.

const NATIVE_INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  fontSize: '14px',
  border: '1px solid #CBD5E0',
  borderRadius: '6px',
  resize: 'vertical',
  fontFamily: 'inherit',
};

const geoJson = new GeoJSON();

const serializeDrawLayer = (
  mapProjection: string,
): { featureCollection: FeatureCollection; bbox: FindBbox } | null => {
  const layer = getDrawLayer();
  const features = layer?.getSource()?.getFeatures() ?? [];
  if (features.length === 0) return null;

  // Circle is a valid OL geometry but NOT a GeoJSON one — writeFeatures
  // throws on it, which used to lose the entire save silently. Convert to
  // a 64-sided polygon before serializing; keeps a radius prop so the
  // editor could reconstruct the circle later if we care to.
  const cloned = features.map((f) => {
    const clone = f.clone();
    clone.setId(f.getId());
    const props = getFeaturePropertiesForExport(f);
    if (props) clone.setProperties(props, true);
    const geom = clone.getGeometry();
    if (geom instanceof CircleGeom) {
      clone.set('radius', geom.getRadius(), true);
      clone.setGeometry(fromCircle(geom, 64));
    }
    return clone;
  });

  let geoJsonString: string;
  try {
    geoJsonString = geoJson.writeFeatures(cloned, {
      dataProjection: 'EPSG:4326',
      featureProjection: mapProjection,
    });
  } catch (e) {
    console.warn('[NewFindPanel] writeFeatures threw', e, cloned);
    return null;
  }
  const featureCollection = JSON.parse(geoJsonString) as FeatureCollection;

  const extent = createEmpty();
  for (const f of cloned) {
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
  const [editingFindId, setEditingFindId] = useAtom(editingFindIdAtom);
  const { setDrawLayerFeatures } = useDrawSettings();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<FindVisibility>('private');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);

  // Seed the panel from the record we're editing exactly once per open.
  // We track the id we've already hydrated so effect re-runs don't reset
  // the user's in-progress edits.
  const hydratedIdRef = useRef<string | null>(null);
  const isEditing = editingFindId != null;

  useEffect(() => {
    if (!isEditing) {
      hydratedIdRef.current = null;
      return;
    }
    if (hydratedIdRef.current === editingFindId) return;

    let cancelled = false;
    setHydrating(true);
    setError(null);

    (async () => {
      let rec: FindRecord;
      try {
        rec = await pb.collection('finds').getOne<FindRecord>(editingFindId!);
      } catch (e) {
        console.warn('[NewFindPanel] load for edit failed', e);
        if (!cancelled) setError(t('finds.newFind.errors.loadFailed'));
        if (!cancelled) setHydrating(false);
        return;
      }
      if (cancelled) return;

      // Refuse to blow away an unsaved sketch without asking. The user
      // may have drawn something under "Draw" and just clicked "Edit" on
      // an old find — bailing here is safer than silently discarding.
      const drawSource = getDrawLayer()?.getSource();
      const existing = drawSource?.getFeatures() ?? [];
      if (existing.length > 0) {
        const ok = window.confirm(t('finds.newFind.confirmDiscardDraft'));
        if (!ok) {
          setEditingFindId(null);
          setHydrating(false);
          return;
        }
      }

      // Hide the persisted copy on findsLayer so the draft doesn't
      // double-render underneath while editing.
      setFindHiddenOnLayer(rec.id, true);

      const projection = map.getView().getProjection().getCode();
      setDrawLayerFeatures(rec.geometry, 'EPSG:4326', true);
      // Reset the view to the find so the user sees what they're editing.
      const extent = transformExtent(rec.bbox, 'EPSG:4326', projection);
      map
        .getView()
        .fit(extent, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 400 });

      setTitle(rec.title);
      setDescription(rec.description ?? '');
      setVisibility(rec.visibility);
      hydratedIdRef.current = rec.id;
      setHydrating(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [editingFindId, isEditing, map, setDrawLayerFeatures, setEditingFindId, t]);

  // On unmount / mode change, restore the persisted find if we hid it and
  // the caller didn't already do so. Belt-and-braces for React strict
  // mode remounts and browser back-navigation.
  useEffect(() => {
    return () => {
      const hydrated = hydratedIdRef.current;
      if (hydrated) setFindHiddenOnLayer(hydrated, false);
    };
  }, []);

  if (!user) {
    return (
      <Text fontSize="sm" color="gray.600">
        {t('finds.newFind.signInPrompt')}
      </Text>
    );
  }

  const canSave = title.trim().length > 0 && !saving && !hydrating;

  const closeAndReset = () => {
    setEditingFindId(null);
    getDrawLayer()?.getSource()?.clear();
    closePanel(null);
  };

  const onCancel = () => {
    const hydrated = hydratedIdRef.current;
    if (hydrated) setFindHiddenOnLayer(hydrated, false);
    hydratedIdRef.current = null;
    closeAndReset();
  };

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
      let saved: FindRecord;
      if (isEditing && editingFindId) {
        saved = await updateFind(editingFindId, {
          title: title.trim(),
          description: description.trim(),
          visibility,
          geometry: payload.featureCollection,
          bbox: payload.bbox,
        });
      } else {
        saved = await createFind(
          {
            title: title.trim(),
            description: description.trim() || undefined,
            visibility,
            geometry: payload.featureCollection,
            bbox: payload.bbox,
          },
          user.id,
        );
      }
      // Push to findsLayer immediately — realtime is best-effort, and
      // the record is what we actually want on-screen. Also un-hides the
      // edited record (upsert re-adds it with the normal style).
      upsertFindOnLayer(saved);
      // If the persisted find didn't produce any renderable features on
      // findsLayer, keep the sketch visible so the user can see their
      // drawing didn't just vanish. Console will tell us why.
      const rendered =
        getFindsLayer()
          ?.getSource()
          ?.getFeatures()
          .filter((f) => f.get(FIND_ID_PROPERTY) === saved.id).length ?? 0;
      hydratedIdRef.current = null;
      setEditingFindId(null);
      closePanel(null);
      if (rendered > 0) {
        getDrawLayer()?.getSource()?.clear();
      } else {
        console.warn(
          '[NewFindPanel] upsert produced 0 renderable features; keeping sketch visible',
        );
      }
    } catch (e) {
      console.warn('[NewFindPanel] save failed', e);
      setError(t('finds.newFind.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const headingKey = isEditing
    ? 'finds.newFind.instructionsEdit'
    : 'finds.newFind.instructions';
  const saveLabel = saving
    ? t('finds.newFind.actions.saving')
    : isEditing
      ? t('finds.newFind.actions.saveEdit')
      : t('finds.newFind.actions.save');

  return (
    <Stack gap={3}>
      <Text fontSize="xs" color="gray.600">
        {t(headingKey)}
      </Text>

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
        <textarea
          value={description}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
            setDescription(e.target.value)
          }
          placeholder={t('finds.newFind.form.descriptionPlaceholder')}
          rows={3}
          maxLength={20000}
          style={NATIVE_INPUT_STYLE}
        />
      </Stack>

      <Stack gap={1}>
        <Text fontSize="xs" fontWeight="semibold">
          {t('finds.newFind.form.visibility')}
        </Text>
        <select
          value={visibility}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            setVisibility(e.target.value as FindVisibility)
          }
          style={{ ...NATIVE_INPUT_STYLE, background: 'white' }}
        >
          <option value="private">{t('finds.visibility.private')}</option>
          <option value="limited">{t('finds.visibility.limited')}</option>
          <option value="public">{t('finds.visibility.public')}</option>
        </select>
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
          <Button size="sm" variant="tertiary" onClick={onCancel}>
            {t('finds.newFind.actions.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            colorPalette="green"
            onClick={onSave}
            disabled={!canSave}
          >
            {saveLabel}
          </Button>
        </HStack>
      </Flex>
    </Stack>
  );
};
