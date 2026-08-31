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
import { useAtomValue } from 'jotai';
import { transformExtent } from 'ol/proj';
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

const VISIBILITY_ORDER: FindVisibility[] = ['private', 'limited', 'public'];

// Compact visibility swap — cycles through private → limited → public.
// A proper dropdown is overkill for three states; the cycle is fast
// and obvious. Colour codes: red / amber / green.
const VisibilityToggle = ({
  value,
  onChange,
}: {
  value: FindVisibility;
  onChange: (v: FindVisibility) => void;
}) => {
  const { t } = useTranslation();
  const next = () => {
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
  onVisibility,
  onDelete,
}: {
  find: FindRecord;
  isMine: boolean;
  onZoom: (f: FindRecord) => void;
  onVisibility: (f: FindRecord, v: FindVisibility) => void;
  onDelete: (f: FindRecord) => void;
}) => {
  const { t } = useTranslation();
  return (
    <Box
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="md"
      p={2}
      _hover={{ bg: 'gray.50' }}
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
            <Badge colorPalette="gray">{t(`finds.visibility.${find.visibility}`)}</Badge>
          )}
          <IconButton
            icon="my_location"
            size="xs"
            variant="ghost"
            aria-label={t('finds.actions.zoom')}
            onClick={() => onZoom(find)}
          />
          {isMine && (
            <IconButton
              icon="delete"
              size="xs"
              variant="ghost"
              colorPalette="red"
              aria-label={t('finds.actions.delete')}
              onClick={() => onDelete(find)}
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
    // Keep the list in sync with realtime edits so a sibling tab's
    // save shows up here without a manual refresh.
    const unsub = subscribeFinds(() => load());
    return unsub;
  }, [load]);

  const zoomTo = useCallback(
    (f: FindRecord) => {
      const projection = map.getView().getProjection().getCode();
      const extent = transformExtent(f.bbox, 'EPSG:4326', projection);
      map.getView().fit(extent, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 400 });
    },
    [map],
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

  const remove = useCallback(async (f: FindRecord) => {
    // Deliberately no confirm dialog for the MVP — a delete undo is
    // more user-friendly and we can add it once the delete rate
    // suggests it's needed. Refactor point: swap this for the KVIB
    // AlertDialog if we hear complaints.
    try {
      await deleteFind(f.id);
    } catch (e) {
      console.warn('[MyFindsPanel] delete failed', e);
    }
  }, []);

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
          onVisibility={changeVisibility}
          onDelete={remove}
        />
      ))}
    </Stack>
  );
};
