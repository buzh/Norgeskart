import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  IconButton,
  Spinner,
  Stack,
  Text,
} from '@kvib/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deleteFind,
  FindRecord,
  FindVisibility,
  listFinds,
  listMyFinds,
  subscribeFinds,
  updateFindVisibility,
} from '../api/finds';
import { currentUserAtom, isAdminAtom } from '../auth/atoms';
import { mapAtom } from '../map/atoms';
import { mapToolAtom } from '../map/overlay/atoms';
import { editingFindIdAtom } from './atoms';

const VISIBILITY_ORDER: FindVisibility[] = ['private', 'limited', 'public'];

// Compact visibility swap — cycles through private → limited → public.
const VisibilityToggle = ({
  value,
  onChange,
}: {
  value: FindVisibility;
  onChange: (v: FindVisibility) => void;
}) => {
  const { t } = useTranslation();
  const next = (e: ReactMouseEvent) => {
    e.stopPropagation();
    const idx = VISIBILITY_ORDER.indexOf(value);
    onChange(VISIBILITY_ORDER[(idx + 1) % VISIBILITY_ORDER.length]);
  };
  const palette =
    value === 'public' ? 'green' : value === 'limited' ? 'yellow' : 'red';
  return (
    <Badge
      as="button"
      onClick={next}
      colorPalette={palette}
      cursor="pointer"
      title={t('finds.visibility.cycleHint')}
    >
      {t(`finds.visibility.${value}`)}
    </Badge>
  );
};

const FindRow = ({
  find,
  isMine,
  onZoom,
  onEdit,
  onVisibility,
  onDelete,
}: {
  find: FindRecord;
  isMine: boolean;
  onZoom: (f: FindRecord) => void;
  onEdit: (f: FindRecord) => void;
  onVisibility: (f: FindRecord, v: FindVisibility) => void;
  onDelete: (f: FindRecord) => void;
}) => {
  const { t } = useTranslation();
  // Any click on the row zooms — the icon buttons still stopPropagation
  // for their own actions so the visibility badge / edit / delete don't
  // also trigger a zoom.
  const stop = (fn: () => void) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <Box
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="md"
      p={2}
      cursor="pointer"
      _hover={{ bg: 'gray.50', borderColor: 'gray.300' }}
      onClick={() => onZoom(find)}
      title={t('finds.actions.zoom')}
    >
      <Flex justify="space-between" align="flex-start" gap={2}>
        <Box flex="1" minW={0}>
          <Text fontWeight="semibold" fontSize="sm" lineClamp={1}>
            {find.title}
          </Text>
          {find.description && (
            <Text fontSize="xs" color="gray.600" lineClamp={2}>
              {find.description}
            </Text>
          )}
          {!isMine && find.expand?.owner && (
            <Text fontSize="xs" color="gray.500" mt={0.5}>
              {t('finds.byOwner', { name: find.expand.owner.name })}
            </Text>
          )}
        </Box>
        <HStack gap={1} flexShrink={0}>
          {isMine ? (
            <VisibilityToggle
              value={find.visibility}
              onChange={(v) => onVisibility(find, v)}
            />
          ) : (
            <Badge colorPalette="gray">
              {t(`finds.visibility.${find.visibility}`)}
            </Badge>
          )}
          {isMine && (
            <IconButton
              icon="edit"
              size="xs"
              variant="ghost"
              aria-label={t('finds.actions.edit')}
              onClick={stop(() => onEdit(find))}
            />
          )}
          {isMine && (
            <IconButton
              icon="delete"
              size="xs"
              variant="ghost"
              colorPalette="red"
              aria-label={t('finds.actions.delete')}
              onClick={stop(() => onDelete(find))}
            />
          )}
        </HStack>
      </Flex>
    </Box>
  );
};

export const MyFindsPanel = () => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const map = useAtomValue(mapAtom);
  const setMapTool = useSetAtom(mapToolAtom);
  const setEditingFindId = useSetAtom(editingFindIdAtom);

  const [items, setItems] = useState<FindRecord[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setItems(null);
    try {
      const data =
        isAdmin && showAll ? await listFinds() : await listMyFinds(user.id);
      setItems(data);
    } catch (e) {
      console.warn('[MyFindsPanel] load failed', e);
      setItems([]);
    }
  }, [user, isAdmin, showAll]);

  useEffect(() => {
    load();
    const unsub = subscribeFinds(() => load());
    return unsub;
  }, [load]);

  const zoomTo = useCallback(
    (f: FindRecord) => {
      const projection = map.getView().getProjection().getCode();
      const extent = transformExtent(f.bbox, 'EPSG:4326', projection);
      map
        .getView()
        .fit(extent, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 400 });
    },
    [map],
  );

  const editIt = useCallback(
    (f: FindRecord) => {
      setEditingFindId(f.id);
      setMapTool('newFind');
    },
    [setEditingFindId, setMapTool],
  );

  const changeVisibility = useCallback(
    async (f: FindRecord, v: FindVisibility) => {
      try {
        await updateFindVisibility(f.id, v);
      } catch (e) {
        console.warn('[MyFindsPanel] visibility update failed', e);
      }
    },
    [],
  );

  const remove = useCallback(
    async (f: FindRecord) => {
      const ok = window.confirm(
        t('finds.mineFunn.confirmDelete', { title: f.title }),
      );
      if (!ok) return;
      try {
        await deleteFind(f.id);
      } catch (e) {
        console.warn('[MyFindsPanel] delete failed', e);
      }
    },
    [t],
  );

  if (!user) {
    return (
      <Text fontSize="sm" color="gray.600">
        {t('finds.mineFunn.signInPrompt')}
      </Text>
    );
  }

  return (
    <Stack gap={2}>
      {isAdmin && (
        <HStack gap={1}>
          <Button
            size="xs"
            variant={showAll ? 'tertiary' : 'primary'}
            onClick={() => setShowAll(false)}
          >
            {t('finds.mineFunn.filter.mine')}
          </Button>
          <Button
            size="xs"
            variant={showAll ? 'primary' : 'tertiary'}
            onClick={() => setShowAll(true)}
          >
            {t('finds.mineFunn.filter.all')}
          </Button>
        </HStack>
      )}
      {items == null && (
        <Flex align="center" gap={2}>
          <Spinner size="xs" />
          <Text fontSize="xs" color="gray.500">
            {t('finds.mineFunn.loading')}
          </Text>
        </Flex>
      )}
      {items && items.length === 0 && (
        <Text fontSize="sm" color="gray.600">
          {t('finds.mineFunn.empty')}
        </Text>
      )}
      {items?.map((f) => (
        <FindRow
          key={f.id}
          find={f}
          isMine={f.owner === user.id}
          onZoom={zoomTo}
          onEdit={editIt}
          onVisibility={changeVisibility}
          onDelete={remove}
        />
      ))}
    </Stack>
  );
};
