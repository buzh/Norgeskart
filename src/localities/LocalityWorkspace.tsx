import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  IconButton,
  Input,
  Spinner,
  Stack,
  Text,
  Tooltip,
} from '@kvib/react';
import { useAtom, useAtomValue } from 'jotai';
import { transformExtent } from 'ol/proj';
import type { ChangeEvent, CSSProperties, FocusEvent, MouseEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createAttachment } from '../api/attachments';
import {
  deleteLocality,
  LocalityBbox,
  LocalityRecord,
  LocalityVisibility,
  updateLocality,
} from '../api/localities';
import {
  createLocalityFind,
  deleteLocalityFind,
  listLocalityFinds,
  LocalityFindRecord,
  LocalityFindStatus,
  subscribeLocalityFinds,
  updateLocalityFind,
} from '../api/localityFinds';
import { currentUserAtom } from '../auth/atoms';
import { DrawControls } from '../draw/drawControls/DrawControls';
import { useDrawSettings } from '../draw/drawControls/hooks/drawSettings';
import { getDrawLayer } from '../draw/drawControls/hooks/mapLayers';
import { lidarExtractSelectionAtom } from '../lidarExtract/atoms';
import { LidarExtractPanel } from '../lidarExtract/LidarExtractPanel';
import { mapAtom } from '../map/atoms';
import { BilderSection } from './BilderSection';
import { KulturminnerSection } from './KulturminnerSection';
import { captureLocalityScreenshot } from './screenshot';
import {
  activeLocalityAtom,
  adjustingLocalityAtom,
  funnDraftActiveAtom,
} from './atoms';
import {
  getFunnExtentOnLayer,
  hideFunnOnLayer,
  removeFunnFromLayer,
  upsertFunnOnLayer,
} from './funnLayer';
import {
  removeLocalityFromLayer,
  setLocalityHighlight,
  upsertLocalityOnLayer,
} from './localityLayer';
import {
  getDrawLayerExtent4326,
  serializeDrawLayer,
} from './serializeDrawLayer';
import { useLocalityAdjust } from './useLocalityAdjust';

const bboxContains = (outer: LocalityBbox, inner: LocalityBbox): boolean =>
  inner[0] >= outer[0] &&
  inner[1] >= outer[1] &&
  inner[2] <= outer[2] &&
  inner[3] <= outer[3];

const bboxUnion = (a: LocalityBbox, b: LocalityBbox): LocalityBbox => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];

const NATIVE_INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  fontSize: '14px',
  border: '1px solid #CBD5E0',
  borderRadius: '6px',
  resize: 'vertical',
  fontFamily: 'inherit',
};

const STATUS_ORDER: LocalityFindStatus[] = [
  'mulig',
  'sannsynlig',
  'avkreftet',
  'rapportert',
];

const STATUS_PALETTE: Record<LocalityFindStatus, string> = {
  mulig: 'yellow',
  sannsynlig: 'green',
  avkreftet: 'red',
  rapportert: 'blue',
};

const StatusBadge = ({
  value,
  editable,
  onChange,
}: {
  value: LocalityFindStatus;
  editable: boolean;
  onChange: (v: LocalityFindStatus) => void;
}) => {
  const { t } = useTranslation();
  const next = (e: MouseEvent) => {
    e.stopPropagation();
    if (!editable) return;
    const idx = STATUS_ORDER.indexOf(value);
    onChange(STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]);
  };
  return (
    <Badge
      as={editable ? 'button' : undefined}
      onClick={next}
      colorPalette={STATUS_PALETTE[value]}
      cursor={editable ? 'pointer' : undefined}
      title={editable ? t('localities.funn.status.cycleHint') : undefined}
    >
      {t(`localities.funn.status.${value}`)}
    </Badge>
  );
};

const FunnRow = ({
  funn,
  editable,
  onZoom,
  onStatus,
  onSaveMeta,
  onEditGeometry,
  onDelete,
}: {
  funn: LocalityFindRecord;
  editable: boolean;
  onZoom: (f: LocalityFindRecord) => void;
  onStatus: (f: LocalityFindRecord, s: LocalityFindStatus) => void;
  onSaveMeta: (f: LocalityFindRecord, title: string, note: string) => void;
  onEditGeometry: (f: LocalityFindRecord) => void;
  onDelete: (f: LocalityFindRecord) => void;
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(funn.title);
  const [note, setNote] = useState(funn.note ?? '');

  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  if (editing) {
    return (
      <Box borderWidth="1px" borderColor="gray.300" borderRadius="md" p={2}>
        <Stack gap={1}>
          <Input
            size="sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
          <textarea
            value={note}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setNote(e.target.value)
            }
            rows={2}
            maxLength={20000}
            style={NATIVE_INPUT_STYLE}
          />
          <HStack justify="flex-end">
            <Button size="xs" variant="tertiary" onClick={() => setEditing(false)}>
              {t('localities.funn.draft.cancel')}
            </Button>
            <Button
              size="xs"
              variant="primary"
              colorPalette="green"
              disabled={title.trim().length === 0}
              onClick={() => {
                onSaveMeta(funn, title.trim(), note.trim());
                setEditing(false);
              }}
            >
              {t('localities.workspace.save')}
            </Button>
          </HStack>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="md"
      p={2}
      cursor="pointer"
      _hover={{ bg: 'gray.50', borderColor: 'gray.300' }}
      onClick={() => onZoom(funn)}
      title={t('localities.funn.actions.zoom')}
    >
      <Flex justify="space-between" align="flex-start" gap={2}>
        <Box flex="1" minW={0}>
          <Text fontWeight="semibold" fontSize="sm" lineClamp={1}>
            {funn.title}
          </Text>
          {funn.note && (
            <Text fontSize="xs" color="gray.600" lineClamp={2}>
              {funn.note}
            </Text>
          )}
        </Box>
        <HStack gap={1} flexShrink={0}>
          <StatusBadge
            value={funn.status}
            editable={editable}
            onChange={(s) => onStatus(funn, s)}
          />
          {editable && (
            <IconButton
              icon="edit"
              size="xs"
              variant="ghost"
              aria-label={t('localities.funn.actions.edit')}
              onClick={stop(() => {
                setTitle(funn.title);
                setNote(funn.note ?? '');
                setEditing(true);
              })}
            />
          )}
          {editable && (
            <IconButton
              icon="draw"
              size="xs"
              variant="ghost"
              aria-label={t('localities.funn.actions.editGeometry')}
              onClick={stop(() => onEditGeometry(funn))}
            />
          )}
          {editable && (
            <IconButton
              icon="delete"
              size="xs"
              variant="ghost"
              colorPalette="red"
              aria-label={t('localities.funn.actions.delete')}
              onClick={stop(() => onDelete(funn))}
            />
          )}
        </HStack>
      </Flex>
    </Box>
  );
};

export const LocalityWorkspace = ({
  locality,
}: {
  locality: LocalityRecord;
}) => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const [, setActiveLocality] = useAtom(activeLocalityAtom);
  const [draftActive, setDraftActive] = useAtom(funnDraftActiveAtom);
  const [adjusting, setAdjusting] = useAtom(adjustingLocalityAtom);
  const [, setLidarSelection] = useAtom(lidarExtractSelectionAtom);
  const [lidarOpen, setLidarOpen] = useState(false);
  const [shooting, setShooting] = useState(false);
  const { setDrawLayerFeatures } = useDrawSettings();

  const isMine = user != null && user.id === locality.owner;

  // Mounts the move/resize interactions while adjustingLocalityAtom is
  // set; persists the bbox after every finished gesture.
  useLocalityAdjust(locality);

  // Lokalitet metadata form.
  const [name, setName] = useState(locality.name);
  const [description, setDescription] = useState(locality.description ?? '');
  const [visibility, setVisibility] = useState<LocalityVisibility>(
    locality.visibility,
  );
  const [savingMeta, setSavingMeta] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Funn list + draft form. editingFunnId non-null means the draft is
  // re-editing an existing funn's drawing rather than creating one.
  const [items, setItems] = useState<LocalityFindRecord[] | null>(null);
  const [editingFunnId, setEditingFunnId] = useState<string | null>(null);
  const [funnTitle, setFunnTitle] = useState('');
  const [funnNote, setFunnNote] = useState('');
  const [savingFunn, setSavingFunn] = useState(false);
  const [funnError, setFunnError] = useState<string | null>(null);

  // The component is keyed by locality.id in Layout, so state initializers
  // above seed fresh on every open. Heavier frame on the open rectangle:
  useEffect(() => {
    setLocalityHighlight(locality.id);
    return () => setLocalityHighlight(null);
  }, [locality.id]);

  // Fresh records get the name field focused with the placeholder name
  // selected (creation flow: drag first, name after).
  const isFreshRecord = locality.name === t('localities.defaultName');

  // Draft/adjust/lidar cleanup when the workspace closes or swaps
  // lokalitet.
  useEffect(() => {
    return () => {
      setDraftActive(false);
      setAdjusting(false);
      setLidarSelection(null);
      getDrawLayer()?.getSource()?.clear();
    };
  }, [locality.id, setDraftActive, setAdjusting, setLidarSelection]);

  const loadFunn = useCallback(async () => {
    try {
      setItems(await listLocalityFinds(locality.id));
    } catch (e) {
      console.warn('[LocalityWorkspace] funn load failed', e);
      setItems([]);
    }
  }, [locality.id]);

  useEffect(() => {
    setItems(null);
    loadFunn();
    const unsub = subscribeLocalityFinds((_action, rec) => {
      if (rec.locality === locality.id) loadFunn();
    });
    return unsub;
  }, [loadFunn, locality.id]);

  const metaDirty =
    name.trim() !== locality.name ||
    description.trim() !== (locality.description ?? '') ||
    visibility !== locality.visibility;

  const saveMeta = async () => {
    setError(null);
    setSavingMeta(true);
    try {
      const updated = await updateLocality(locality.id, {
        name: name.trim(),
        description: description.trim(),
        visibility,
      });
      upsertLocalityOnLayer(updated);
      setActiveLocality(updated);
    } catch (e) {
      console.warn('[LocalityWorkspace] save failed', e);
      setError(t('localities.workspace.saveFailed'));
    } finally {
      setSavingMeta(false);
    }
  };

  const zoomToLocality = () => {
    const projection = map.getView().getProjection().getCode();
    const extent = transformExtent(locality.bbox, 'EPSG:4326', projection);
    map
      .getView()
      .fit(extent, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 400 });
  };

  const removeLocality = async () => {
    const ok = window.confirm(
      t('localities.workspace.confirmDelete', { name: locality.name }),
    );
    if (!ok) return;
    try {
      await deleteLocality(locality.id);
      removeLocalityFromLayer(locality.id);
      setActiveLocality(null);
    } catch (e) {
      console.warn('[LocalityWorkspace] delete failed', e);
      setError(t('localities.workspace.saveFailed'));
    }
  };

  const startDraft = () => {
    // Leftovers on the shared draw layer can only be an abandoned draft;
    // drop them so the new funn starts clean.
    getDrawLayer()?.getSource()?.clear();
    setAdjusting(false);
    setEditingFunnId(null);
    setFunnTitle('');
    setFunnNote('');
    setFunnError(null);
    setDraftActive(true);
  };

  const startGeometryEdit = (f: LocalityFindRecord) => {
    getDrawLayer()?.getSource()?.clear();
    setAdjusting(false);
    setDrawLayerFeatures(f.geometry, 'EPSG:4326', true);
    hideFunnOnLayer(f.id);
    setEditingFunnId(f.id);
    setFunnTitle(f.title);
    setFunnNote(f.note ?? '');
    setFunnError(null);
    setDraftActive(true);
  };

  const cancelDraft = () => {
    getDrawLayer()?.getSource()?.clear();
    if (editingFunnId) {
      // Restore the hidden persisted copy.
      const rec = items?.find((it) => it.id === editingFunnId);
      if (rec) upsertFunnOnLayer(rec);
      setEditingFunnId(null);
    }
    setDraftActive(false);
  };

  const saveDraft = async () => {
    setFunnError(null);
    const projection = map.getView().getProjection().getCode();
    const geometry = serializeDrawLayer(projection);
    if (!geometry) {
      setFunnError(t('localities.funn.draft.noGeometry'));
      return;
    }
    if (!user) return;

    // A lokalitet holds the entire extent of its funn — offer to grow
    // the rectangle when the drawing sticks out.
    const drawnBbox = getDrawLayerExtent4326(projection);
    let currentLocality = locality;
    if (drawnBbox && !bboxContains(currentLocality.bbox, drawnBbox)) {
      const grow = window.confirm(t('localities.funn.growConfirm'));
      if (!grow) return;
      try {
        currentLocality = await updateLocality(locality.id, {
          bbox: bboxUnion(currentLocality.bbox, drawnBbox),
        });
        upsertLocalityOnLayer(currentLocality);
        setActiveLocality(currentLocality);
      } catch (e) {
        console.warn('[LocalityWorkspace] grow-to-fit failed', e);
        setFunnError(t('localities.workspace.saveFailed'));
        return;
      }
    }

    setSavingFunn(true);
    try {
      let saved: LocalityFindRecord;
      if (editingFunnId) {
        saved = await updateLocalityFind(editingFunnId, {
          title: funnTitle.trim(),
          note: funnNote.trim(),
          geometry,
        });
        setItems((prev) =>
          prev ? prev.map((it) => (it.id === saved.id ? saved : it)) : prev,
        );
      } else {
        saved = await createLocalityFind(
          {
            locality: locality.id,
            title: funnTitle.trim(),
            note: funnNote.trim() || undefined,
            geometry,
          },
          user.id,
        );
        setItems((prev) => (prev ? [...prev, saved] : [saved]));
      }
      upsertFunnOnLayer(saved);
      getDrawLayer()?.getSource()?.clear();
      setEditingFunnId(null);
      setDraftActive(false);
    } catch (e) {
      console.warn('[LocalityWorkspace] funn save failed', e);
      setFunnError(t('localities.funn.saveFailed'));
    } finally {
      setSavingFunn(false);
    }
  };

  // LiDAR extract seeded with the lokalitet's rectangle — no manual box
  // drag needed inside the workspace (the panel's "tegn på nytt" still
  // allows a custom sub-box).
  const openLidar = () => {
    if (draftActive) cancelDraft();
    setAdjusting(false);
    const mapProjection = map.getView().getProjection().getCode();
    setLidarSelection({
      bboxMap: transformExtent(
        locality.bbox,
        'EPSG:4326',
        mapProjection,
      ) as [number, number, number, number],
      mapProjection,
      bbox25833: transformExtent(
        locality.bbox,
        'EPSG:4326',
        'EPSG:25833',
      ) as [number, number, number, number],
      bboxLonLat: locality.bbox,
    });
    setLidarOpen(true);
  };

  const closeLidar = () => {
    setLidarOpen(false);
    setLidarSelection(null);
  };

  // Capture the current view cropped to the rectangle → Bilder. The
  // BilderSection realtime subscription picks the new attachment up.
  const takeScreenshot = async () => {
    if (!user || shooting) return;
    setShooting(true);
    try {
      const blob = await captureLocalityScreenshot(map, locality.bbox);
      if (!blob) {
        window.alert(t('localities.tools.screenshotFailed'));
        return;
      }
      await createAttachment(
        {
          locality: locality.id,
          kind: 'screenshot',
          caption: `${t('localities.tools.screenshotCaption')} ${new Date().toLocaleDateString('nb-NO')}`,
        },
        user.id,
        blob,
        'skjermbilde.png',
      );
    } catch (e) {
      console.warn('[LocalityWorkspace] screenshot failed', e);
      window.alert(t('localities.tools.screenshotFailed'));
    } finally {
      setShooting(false);
    }
  };

  const zoomToFunn = (f: LocalityFindRecord) => {
    const extent = getFunnExtentOnLayer(f.id);
    if (!extent) return;
    map
      .getView()
      .fit(extent, { padding: [120, 120, 120, 120], maxZoom: 19, duration: 400 });
  };

  const changeStatus = async (
    f: LocalityFindRecord,
    status: LocalityFindStatus,
  ) => {
    try {
      const updated = await updateLocalityFind(f.id, { status });
      setItems((prev) =>
        prev ? prev.map((it) => (it.id === f.id ? updated : it)) : prev,
      );
    } catch (e) {
      console.warn('[LocalityWorkspace] status update failed', e);
    }
  };

  const saveFunnMeta = async (
    f: LocalityFindRecord,
    title: string,
    note: string,
  ) => {
    try {
      const updated = await updateLocalityFind(f.id, { title, note });
      setItems((prev) =>
        prev ? prev.map((it) => (it.id === f.id ? updated : it)) : prev,
      );
    } catch (e) {
      console.warn('[LocalityWorkspace] funn update failed', e);
    }
  };

  const removeFunn = async (f: LocalityFindRecord) => {
    const ok = window.confirm(
      t('localities.funn.confirmDelete', { title: f.title }),
    );
    if (!ok) return;
    try {
      await deleteLocalityFind(f.id);
      removeFunnFromLayer(f.id);
      setItems((prev) => (prev ? prev.filter((it) => it.id !== f.id) : prev));
    } catch (e) {
      console.warn('[LocalityWorkspace] funn delete failed', e);
    }
  };

  return (
    <Stack
      width="100%"
      maxHeight="calc(100vh - 80px)"
      pointerEvents="auto"
      bg="white"
      shadow="lg"
      p={4}
      m={{ base: 0, md: 1 }}
      mr={{ base: 0, md: 3 }}
      borderRadius="16px"
      overflowY="auto"
      gap={3}
    >
      {/* Header row */}
      <Flex align="center" gap={1}>
        <IconButton
          icon="arrow_back"
          variant="ghost"
          size="sm"
          aria-label={t('localities.workspace.back')}
          onClick={() => setActiveLocality(null)}
        />
        <Heading size="sm" flex="1" lineClamp={1}>
          {locality.name}
        </Heading>
        <IconButton
          icon="zoom_in_map"
          variant="ghost"
          size="sm"
          aria-label={t('localities.workspace.zoom')}
          onClick={zoomToLocality}
        />
        {isMine && (
          <Tooltip content={t('localities.workspace.adjust')}>
            <IconButton
              icon="transform"
              variant={adjusting ? 'primary' : 'ghost'}
              colorPalette="green"
              size="sm"
              aria-label={t('localities.workspace.adjust')}
              onClick={() => {
                if (!adjusting && draftActive) cancelDraft();
                setAdjusting(!adjusting);
              }}
            />
          </Tooltip>
        )}
        {isMine && (
          <IconButton
            icon="delete"
            variant="ghost"
            colorPalette="red"
            size="sm"
            aria-label={t('localities.workspace.deleteLocality')}
            onClick={removeLocality}
          />
        )}
      </Flex>

      {/* Metadata */}
      <Stack gap={2}>
        <Stack gap={1}>
          <Text fontSize="xs" fontWeight="semibold">
            {t('localities.workspace.name')}
          </Text>
          <Input
            size="sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e: FocusEvent<HTMLInputElement>) =>
              isFreshRecord && e.target.select()
            }
            autoFocus={isFreshRecord}
            placeholder={t('localities.workspace.namePlaceholder')}
            maxLength={200}
            disabled={!isMine}
          />
        </Stack>
        <Stack gap={1}>
          <Text fontSize="xs" fontWeight="semibold">
            {t('localities.workspace.description')}
          </Text>
          <textarea
            value={description}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setDescription(e.target.value)
            }
            placeholder={t('localities.workspace.descriptionPlaceholder')}
            rows={2}
            maxLength={20000}
            disabled={!isMine}
            style={NATIVE_INPUT_STYLE}
          />
        </Stack>
        <Stack gap={1}>
          <Text fontSize="xs" fontWeight="semibold">
            {t('localities.workspace.visibility')}
          </Text>
          <select
            value={visibility}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              setVisibility(e.target.value as LocalityVisibility)
            }
            disabled={!isMine}
            style={{ ...NATIVE_INPUT_STYLE, background: 'white' }}
          >
            <option value="private">{t('localities.visibility.private')}</option>
            <option value="limited">{t('localities.visibility.limited')}</option>
            <option value="public">{t('localities.visibility.public')}</option>
          </select>
          {visibility === 'limited' && (
            <Text fontSize="xs" color="gray.500">
              {t('localities.visibility.limitedHint')}
            </Text>
          )}
        </Stack>
        {error && (
          <Text fontSize="xs" color="red.600">
            {error}
          </Text>
        )}
        {isMine && metaDirty && (
          <Flex justify="flex-end">
            <Button
              size="sm"
              variant="primary"
              colorPalette="green"
              onClick={saveMeta}
              disabled={savingMeta || name.trim().length === 0}
            >
              {savingMeta
                ? t('localities.workspace.saving')
                : t('localities.workspace.save')}
            </Button>
          </Flex>
        )}
      </Stack>

      {/* Kjente kulturminner — "is this already registered?" up front. */}
      <KulturminnerSection locality={locality} />

      {/* Funn */}
      <Stack gap={2}>
        <Flex justify="space-between" align="center">
          <Heading size="xs">{t('localities.funn.heading')}</Heading>
          {isMine && !draftActive && (
            <Button
              size="xs"
              variant="secondary"
              colorPalette="green"
              leftIcon="add"
              onClick={startDraft}
            >
              {t('localities.funn.new')}
            </Button>
          )}
        </Flex>

        {draftActive && (
          <Stack
            gap={2}
            borderWidth="1px"
            borderColor="gray.200"
            borderRadius="md"
            p={2}
          >
            <Text fontSize="xs" color="gray.600">
              {t(
                editingFunnId
                  ? 'localities.funn.draft.instructionsEdit'
                  : 'localities.funn.draft.instructions',
              )}
            </Text>
            <DrawControls />
            <Input
              size="sm"
              value={funnTitle}
              onChange={(e) => setFunnTitle(e.target.value)}
              placeholder={t('localities.funn.draft.titlePlaceholder')}
              maxLength={200}
            />
            <textarea
              value={funnNote}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setFunnNote(e.target.value)
              }
              placeholder={t('localities.funn.draft.notePlaceholder')}
              rows={2}
              maxLength={20000}
              style={NATIVE_INPUT_STYLE}
            />
            {funnError && (
              <Text fontSize="xs" color="red.600">
                {funnError}
              </Text>
            )}
            <Flex justify="flex-end">
              <HStack>
                <Button size="sm" variant="tertiary" onClick={cancelDraft}>
                  {t('localities.funn.draft.cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  colorPalette="green"
                  onClick={saveDraft}
                  disabled={savingFunn || funnTitle.trim().length === 0}
                >
                  {savingFunn
                    ? t('localities.workspace.saving')
                    : t('localities.funn.draft.save')}
                </Button>
              </HStack>
            </Flex>
          </Stack>
        )}

        {items == null && (
          <Flex align="center" gap={2}>
            <Spinner size="xs" />
            <Text fontSize="xs" color="gray.500">
              {t('localities.funn.loading')}
            </Text>
          </Flex>
        )}
        {items && items.length === 0 && !draftActive && (
          <Text fontSize="sm" color="gray.600">
            {t('localities.funn.empty')}
          </Text>
        )}
        {items?.map((f) => (
          <FunnRow
            key={f.id}
            funn={f}
            editable={isMine}
            onZoom={zoomToFunn}
            onStatus={changeStatus}
            onSaveMeta={saveFunnMeta}
            onEditGeometry={startGeometryEdit}
            onDelete={removeFunn}
          />
        ))}
      </Stack>

      {/* Bilder */}
      {user && (
        <BilderSection locality={locality} userId={user.id} isMine={isMine} />
      )}

      {/* Verktøy */}
      <Stack gap={2}>
        <Heading size="xs">{t('localities.tools.heading')}</Heading>
        {!lidarOpen ? (
          <HStack>
            <Button
              size="xs"
              variant="secondary"
              colorPalette="green"
              leftIcon="crop_free"
              onClick={openLidar}
            >
              {t('localities.tools.lidarExtract')}
            </Button>
            {isMine && (
              <Button
                size="xs"
                variant="secondary"
                colorPalette="green"
                leftIcon="photo_camera"
                disabled={shooting}
                onClick={takeScreenshot}
              >
                {shooting
                  ? t('localities.tools.screenshotTaking')
                  : t('localities.tools.screenshot')}
              </Button>
            )}
          </HStack>
        ) : (
          <Stack
            gap={2}
            borderWidth="1px"
            borderColor="gray.200"
            borderRadius="md"
            p={2}
          >
            <Flex justify="space-between" align="center">
              <Text fontSize="sm" fontWeight="semibold">
                {t('localities.tools.lidarExtract')}
              </Text>
              <IconButton
                icon="close"
                size="xs"
                variant="ghost"
                aria-label={t('localities.tools.closeLidar')}
                onClick={closeLidar}
              />
            </Flex>
            <LidarExtractPanel />
          </Stack>
        )}
      </Stack>
    </Stack>
  );
};
