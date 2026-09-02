import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Spinner,
  Stack,
  Text,
} from '@kvib/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listLocalities,
  listMyLocalities,
  LocalityRecord,
  subscribeLocalities,
} from '../api/localities';
import { currentUserAtom, isAdminAtom } from '../auth/atoms';
import { mapAtom } from '../map/atoms';
import { mapToolAtom } from '../map/overlay/atoms';
import { activeLocalityAtom } from './atoms';

const VISIBILITY_PALETTE: Record<LocalityRecord['visibility'], string> = {
  private: 'red',
  limited: 'yellow',
  public: 'green',
};

const LocalityRow = ({
  locality,
  isMine,
  onOpen,
}: {
  locality: LocalityRecord;
  isMine: boolean;
  onOpen: (l: LocalityRecord) => void;
}) => {
  const { t } = useTranslation();
  return (
    <Box
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="md"
      p={2}
      cursor="pointer"
      _hover={{ bg: 'gray.50', borderColor: 'gray.300' }}
      onClick={() => onOpen(locality)}
      title={t('localities.panel.openHint')}
    >
      <Flex justify="space-between" align="flex-start" gap={2}>
        <Box flex="1" minW={0}>
          <Text fontWeight="semibold" fontSize="sm" lineClamp={1}>
            {locality.name}
          </Text>
          {locality.description && (
            <Text fontSize="xs" color="gray.600" lineClamp={2}>
              {locality.description}
            </Text>
          )}
          {!isMine && locality.expand?.owner && (
            <Text fontSize="xs" color="gray.500" mt={0.5}>
              {t('localities.byOwner', { name: locality.expand.owner.name })}
            </Text>
          )}
        </Box>
        <Badge colorPalette={VISIBILITY_PALETTE[locality.visibility]}>
          {t(`localities.visibility.${locality.visibility}`)}
        </Badge>
      </Flex>
    </Box>
  );
};

export const LocalitiesPanel = () => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const map = useAtomValue(mapAtom);
  const setMapTool = useSetAtom(mapToolAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);

  const [items, setItems] = useState<LocalityRecord[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setItems(null);
    try {
      const data =
        isAdmin && showAll
          ? await listLocalities()
          : await listMyLocalities(user.id);
      setItems(data);
    } catch (e) {
      console.warn('[LocalitiesPanel] load failed', e);
      setItems([]);
    }
  }, [user, isAdmin, showAll]);

  useEffect(() => {
    load();
    const unsub = subscribeLocalities(() => load());
    return unsub;
  }, [load]);

  const open = useCallback(
    (l: LocalityRecord) => {
      const projection = map.getView().getProjection().getCode();
      const extent = transformExtent(l.bbox, 'EPSG:4326', projection);
      map
        .getView()
        .fit(extent, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 400 });
      setActiveLocality(l);
      setMapTool(null);
    },
    [map, setActiveLocality, setMapTool],
  );

  if (!user) {
    return (
      <Text fontSize="sm" color="gray.600">
        {t('localities.panel.signInPrompt')}
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
            {t('localities.panel.filter.mine')}
          </Button>
          <Button
            size="xs"
            variant={showAll ? 'primary' : 'tertiary'}
            onClick={() => setShowAll(true)}
          >
            {t('localities.panel.filter.all')}
          </Button>
        </HStack>
      )}
      {items == null && (
        <Flex align="center" gap={2}>
          <Spinner size="xs" />
          <Text fontSize="xs" color="gray.500">
            {t('localities.panel.loading')}
          </Text>
        </Flex>
      )}
      {items && items.length === 0 && (
        <Text fontSize="sm" color="gray.600">
          {t('localities.panel.empty')}
        </Text>
      )}
      {items?.map((l) => (
        <LocalityRow
          key={l.id}
          locality={l}
          isMine={l.owner === user.id}
          onOpen={open}
        />
      ))}
    </Stack>
  );
};
