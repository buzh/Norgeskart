import { Badge, Box, Flex, Heading, Spinner, Stack, Text } from '@kvib/react';
import { transformExtent } from 'ol/proj';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchKulturminnerInBbox,
  KnownKulturminne,
  KulturminnerResult,
} from '../api/kulturminnerWfs';
import { LocalityRecord } from '../api/localities';

// Register codes → readable labels. Domain vocabulary from Askeladden,
// left in Norwegian on purpose; unknown codes fall back to the raw code.
const KATEGORI_LABELS: Record<string, string> = {
  'L-ARK': 'Arkeologisk minne',
  'L-BVF': 'Bebyggelse/infrastruktur',
  'L-KRK': 'Kirkested',
};

const VERNETYPE_LABELS: Record<string, string> = {
  AUT: 'Automatisk fredet',
  VED: 'Vedtaksfredet',
  FOR: 'Forskriftsfredet',
  MID: 'Midlertidig fredet',
  LIST: 'Listeført',
  KOM: 'Kommunalt vern',
  UAV: 'Uavklart',
  IKKE: 'Ikke fredet',
  FJE: 'Fjernet',
};

const KulturminneRow = ({ km }: { km: KnownKulturminne }) => {
  const { t } = useTranslation();
  const name = km.navn || t('localities.kulturminner.unnamed');
  const kategori = KATEGORI_LABELS[km.kategori] ?? km.kategori;
  const vern = VERNETYPE_LABELS[km.vernetype] ?? km.vernetype;
  const body = (
    <Flex justify="space-between" align="center" gap={2} py={1}>
      <Box flex="1" minW={0}>
        <Text fontSize="xs" fontWeight="medium" lineClamp={1}>
          {name}
          {km.antallEnkeltminner != null && km.antallEnkeltminner > 1
            ? ` (${km.antallEnkeltminner})`
            : ''}
        </Text>
        <Text fontSize="10px" color="gray.600" lineClamp={1}>
          {[kategori, vern].filter(Boolean).join(' · ')}
        </Text>
      </Box>
      {km.linkKulturminnesok && (
        <Text fontSize="10px" color="green.700" flexShrink={0}>
          Kulturminnesøk ↗
        </Text>
      )}
    </Flex>
  );
  return km.linkKulturminnesok ? (
    <a
      href={km.linkKulturminnesok}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: 'block', borderBottom: '1px solid #EDF2F7' }}
      title={t('localities.kulturminner.openLink')}
    >
      {body}
    </a>
  ) : (
    <Box borderBottom="1px solid #EDF2F7">{body}</Box>
  );
};

export const KulturminnerSection = ({
  locality,
}: {
  locality: LocalityRecord;
}) => {
  const { t } = useTranslation();
  const [result, setResult] = useState<KulturminnerResult | null>(null);
  const [error, setError] = useState(false);

  const bboxKey = locality.bbox.join(',');

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(false);
    const bbox25833 = transformExtent(
      locality.bbox,
      'EPSG:4326',
      'EPSG:25833',
    ) as [number, number, number, number];
    fetchKulturminnerInBbox(bbox25833)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e) => {
        console.warn('[KulturminnerSection] fetch failed', e);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
    // bboxKey re-fires when the rectangle is adjusted.
  }, [bboxKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack gap={1}>
      <Flex align="center" gap={2}>
        <Heading size="xs">{t('localities.kulturminner.heading')}</Heading>
        {result && (
          <Badge colorPalette={result.items.length > 0 ? 'yellow' : 'green'}>
            {result.truncated
              ? `${result.items.length}+`
              : result.items.length}
          </Badge>
        )}
      </Flex>
      {!result && !error && (
        <Flex align="center" gap={2}>
          <Spinner size="xs" />
          <Text fontSize="xs" color="gray.500">
            {t('localities.kulturminner.loading')}
          </Text>
        </Flex>
      )}
      {error && (
        <Text fontSize="xs" color="gray.500">
          {t('localities.kulturminner.error')}
        </Text>
      )}
      {result && result.items.length === 0 && (
        <Text fontSize="xs" color="gray.600">
          {t('localities.kulturminner.empty')}
        </Text>
      )}
      {result && result.items.length > 0 && (
        <Box maxH="160px" overflowY="auto">
          {result.items.map((km, i) => (
            <KulturminneRow key={i} km={km} />
          ))}
        </Box>
      )}
    </Stack>
  );
};
