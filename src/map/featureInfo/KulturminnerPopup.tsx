import { Badge, Box, Button, Flex, IconButton, Link, Stack, Text } from '@kvib/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Overlay } from 'ol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { selectedResultAtom } from '../../search/atoms';
import { mapAtom } from '../atoms';
import { ProjectionIdentifier } from '../projections/types';
import { kulturminnerPopupAtom } from './atoms';
import type { LayerFeatureInfo } from './types';
import { buildCoordinateResult } from './useFeatureInfo';

type FeatureKind =
  | 'lokalitet'
  | 'enkeltminne'
  | 'sikringssone'
  | 'sefrak'
  | 'kulturmiljo'
  | 'brukerminne'
  | 'other';

interface HeritageFeature {
  kind: FeatureKind;
  layerTitle: string;
  properties: Record<string, string | number | boolean | null>;
}

interface HeritageGroup {
  key: string;
  parentId: string;
  navn: string;
  lokalitet?: HeritageFeature;
  enkeltminner: HeritageFeature[];
  sikringssoner: HeritageFeature[];
  others: HeritageFeature[];
}

const classifyLayerId = (layerId: string): FeatureKind => {
  if (layerId === 'theme.heritageSites') return 'lokalitet';
  if (layerId === 'theme.culturalEnvironments') return 'kulturmiljo';
  if (layerId === 'theme.sefrakBuildings') return 'sefrak';
  if (layerId === 'theme.protectedBuildings') return 'lokalitet';
  if (layerId === 'theme.userReportedHeritage') return 'brukerminne';
  return 'other';
};

// The Kulturminner WMS returns each feature under a sublayer element name
// (Lokaliteter_layer / Enkeltminner_layer / Sikringssoner_layer, plus their
// *ikoner duplicates). parseXmlFeatureInfo loses that element name, so we
// re-derive the sublayer kind from the property fingerprint.
const refineHeritageSitesKind = (
  properties: Record<string, unknown>,
): FeatureKind => {
  if ('enkeltminneart' in properties || 'lokalitetid' in properties)
    return 'enkeltminne';
  if ('lokalitetsart' in properties || 'antallenkeltminner' in properties)
    return 'lokalitet';
  // Sikringssoner have very few fields — a kulturminneid but no navn,
  // no vernetype, no lokalitetsart, no enkeltminneart.
  if (
    'kulturminneid' in properties &&
    !('navn' in properties) &&
    !('lokalitetsart' in properties) &&
    !('enkeltminneart' in properties)
  )
    return 'sikringssone';
  return 'lokalitet';
};

const stringify = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  return String(v);
};

const getParentId = (feature: HeritageFeature, fallbackIndex: number): string => {
  const p = feature.properties;
  if (feature.kind === 'enkeltminne') {
    // lokalitetid preferred; fallback to lokalid split on "-"
    const lokalitetid = stringify(p['lokalitetid']);
    if (lokalitetid) return lokalitetid;
    const lokalid = stringify(p['lokalid']);
    if (lokalid) return lokalid.split('-')[0];
  }
  if (feature.kind === 'lokalitet') {
    // Some records have a suffixed id like "300651-0"; the parent lokalitetid
    // used by enkeltminner is the numeric prefix. Strip it so the enkeltminner
    // land in the same group.
    const raw =
      stringify(p['kulturminneid']) ||
      stringify(p['lokalid']) ||
      stringify(p['lokalitetid']);
    if (raw) return raw.split('-')[0];
    return `lok-${fallbackIndex}`;
  }
  if (feature.kind === 'sikringssone') {
    // Sikringssoner have their own id space; keep them as their own group.
    return 'sz-' + (stringify(p['lokalid']) || stringify(p['kulturminneid']) || fallbackIndex);
  }
  return (
    stringify(p['lokalid']) ||
    stringify(p['kulturminneid']) ||
    stringify(p['objid']) ||
    `other-${fallbackIndex}`
  );
};

const toHeritageFeatures = (
  layers: LayerFeatureInfo[],
): HeritageFeature[] => {
  const out: HeritageFeature[] = [];
  for (const layer of layers) {
    const baseKind = classifyLayerId(layer.layerId);
    for (const feature of layer.features) {
      const kind =
        baseKind === 'lokalitet'
          ? refineHeritageSitesKind(feature.properties)
          : baseKind;
      out.push({
        kind,
        layerTitle: layer.layerTitle,
        properties: feature.properties,
      });
    }
  }
  return out;
};

const groupFeatures = (layers: LayerFeatureInfo[]): HeritageGroup[] => {
  const features = toHeritageFeatures(layers);

  // Dedupe *ikoner duplicates: same kind + same identifying id.
  const dedupeKey = (f: HeritageFeature) =>
    `${f.kind}::${stringify(f.properties['lokalid']) || stringify(f.properties['kulturminneid'])}`;
  const seen = new Map<string, HeritageFeature>();
  for (const f of features) {
    const k = dedupeKey(f);
    const prev = seen.get(k);
    if (!prev || Object.keys(f.properties).length > Object.keys(prev.properties).length) {
      seen.set(k, f);
    }
  }

  const groups = new Map<string, HeritageGroup>();
  let fallback = 0;
  for (const f of seen.values()) {
    const parentId = getParentId(f, fallback++);
    let g = groups.get(parentId);
    if (!g) {
      g = {
        key: parentId,
        parentId,
        navn: '',
        enkeltminner: [],
        sikringssoner: [],
        others: [],
      };
      groups.set(parentId, g);
    }
    if (f.kind === 'lokalitet') g.lokalitet = f;
    else if (f.kind === 'enkeltminne') g.enkeltminner.push(f);
    else if (f.kind === 'sikringssone') g.sikringssoner.push(f);
    else g.others.push(f);
  }

  // Fill navn: lokalitet.navn → first enkeltminne.navn → fallback per-kind.
  for (const g of groups.values()) {
    const fromLokalitet = stringify(g.lokalitet?.properties['navn']);
    const fromEnkeltminne = stringify(g.enkeltminner[0]?.properties['navn']);
    if (fromLokalitet) g.navn = fromLokalitet;
    else if (fromEnkeltminne) g.navn = fromEnkeltminne;
    else if (g.sikringssoner.length > 0) g.navn = `Sikringssone`;
    else if (g.others.length > 0)
      g.navn = g.others[0].layerTitle;
    else g.navn = 'Kulturminne';
  }

  const all = Array.from(groups.values());

  // Kulturminnesøk doesn't surface sikringssoner as first-class results —
  // they're implicit protection metadata for a lokalitet. Drop pure
  // sikringssone groups when there's any real POI in the click; otherwise
  // keep them so a lone sikringssone click still shows something.
  const hasReal = all.some((g) => g.lokalitet || g.enkeltminner.length > 0);
  if (hasReal) {
    return all.filter((g) => g.lokalitet || g.enkeltminner.length > 0 || g.others.length > 0);
  }
  return all;
};

// Roll up a field across a lokalitet + its enkeltminner, following the
// Kulturminnesøk pattern: if the values agree, show the shared value;
// if they disagree, show a "Flere/Ulike …" aggregate label.
const rollup = (
  values: string[],
  aggregateLabel: string,
): string => {
  const unique = Array.from(new Set(values.filter((v) => v.length > 0)));
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  return aggregateLabel;
};

const formatDate = (v: unknown): string => {
  const s = stringify(v);
  if (!s) return '';
  // "2014-12-17 00:00:00" → "2014-12-17"
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s;
};

const FieldRow = ({ label, value }: { label: string; value: string }) => (
  <Flex gap={2} fontSize="sm" align="baseline">
    <Text
      color="gray.600"
      fontWeight="medium"
      flexShrink={0}
      minW="100px"
      maxW="120px"
    >
      {label}
    </Text>
    <Text flex="1" wordBreak="break-word">
      {value}
    </Text>
  </Flex>
);

const NestedEnkeltminner = ({
  features,
}: {
  features: HeritageFeature[];
}) => (
  <Box mt={3}>
    <Text fontSize="xs" fontWeight="bold" color="gray.600" mb={1}>
      Enkeltminner ved klikket ({features.length})
    </Text>
    <Stack gap={2}>
      {features.map((em, i) => {
        const p = em.properties;
        const emNavn = stringify(p['navn']);
        const emArt = stringify(p['enkeltminneart']);
        const emKategori = stringify(p['enkeltminnekategori']);
        const emId = stringify(p['lokalid']);
        const emVerne = stringify(p['vernetype']);
        const emDatering = stringify(p['datering']);
        const subtitle = [emArt, emKategori].filter(Boolean).join(' — ');
        return (
          <Box key={i} pl={2} borderLeft="2px solid" borderColor="gray.200">
            <Text fontSize="sm" wordBreak="break-word">
              {emNavn || emArt || `Enkeltminne #${emId}`}
            </Text>
            {subtitle && emNavn && (
              <Text fontSize="xs" color="gray.500" wordBreak="break-word">
                {subtitle}
              </Text>
            )}
            {(emVerne || emDatering) && (
              <Flex gap={2} mt={0.5} wrap="wrap">
                {emVerne && (
                  <Badge colorPalette="green" size="sm">
                    {emVerne}
                  </Badge>
                )}
                {emDatering && (
                  <Text fontSize="xs" color="gray.600">
                    {emDatering}
                  </Text>
                )}
              </Flex>
            )}
          </Box>
        );
      })}
    </Stack>
  </Box>
);

const HeritageCard = ({ group }: { group: HeritageGroup }) => {
  const [descOpen, setDescOpen] = useState(false);
  const primary = group.lokalitet ?? group.enkeltminner[0] ?? group.sikringssoner[0] ?? group.others[0];
  const props = primary?.properties ?? {};

  const artRaw =
    stringify(props['lokalitetsart']) || stringify(props['enkeltminneart']);
  const kategoriRaw =
    stringify(props['lokaliteteskategori']) ||
    stringify(props['enkeltminnekategori']);
  const artKategori = [artRaw, kategoriRaw].filter(Boolean).join(' — ');

  const kommune = stringify(props['kommune']);
  const fylke = stringify(props['fylke']);
  const beliggenhet = [fylke, kommune].filter(Boolean).join(', ');

  // Roll up vernetype + datering across the lokalitet's own field AND all
  // its nested enkeltminner. If they agree, show the value; if not, show
  // the "Ulike vernestatus" / "Flere dateringer" aggregate label the way
  // Kulturminnesøk does.
  const memberProps = [
    ...(group.lokalitet ? [group.lokalitet.properties] : []),
    ...group.enkeltminner.map((em) => em.properties),
  ];
  const vernetype = rollup(
    memberProps.map((p) => stringify(p['vernetype'])),
    'Ulike vernestatus',
  );
  const datering = rollup(
    memberProps.map((p) => stringify(p['datering'])),
    'Flere dateringer',
  );
  // vernedato only if there's a single shared vernetype AND a single shared
  // date across all members; otherwise a single date next to "Ulike
  // vernestatus" would misrepresent when the mixed statuses were assigned.
  const uniqueVerne = new Set(
    memberProps.map((p) => stringify(p['vernetype'])).filter(Boolean),
  );
  const uniqueVerneDato = new Set(
    memberProps.map((p) => formatDate(p['vernedato'])).filter(Boolean),
  );
  const vernedato =
    uniqueVerne.size === 1 && uniqueVerneDato.size === 1
      ? Array.from(uniqueVerneDato)[0]
      : '';
  const antall =
    group.lokalitet && stringify(group.lokalitet.properties['antallenkeltminner']);
  const informasjon = stringify(props['informasjon']);
  // Links only apply to real POIs — sikringssoner have their own id space
  // and a synthesized askeladden URL for a sikringssone id doesn't resolve.
  const hasReal = !!group.lokalitet || group.enkeltminner.length > 0;
  const askeladden = hasReal
    ? stringify(props['linkaskeladden']) ||
      (props['lokalid']
        ? `https://askeladden.ra.no/askeladden/?kid=${stringify(props['lokalid'])}`
        : '')
    : '';
  const kulturminnesok = hasReal ? stringify(props['linkkulturminnesok']) : '';

  return (
    <Box
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="8px"
      p={3}
      w="full"
      minW={0}
    >
      <Stack gap={0.5} mb={2}>
        <Text fontWeight="bold" fontSize="md" wordBreak="break-word">
          {group.navn}
        </Text>
        <Flex gap={2} align="center" wrap="wrap">
          <Text fontSize="xs" color="gray.500">
            #{group.parentId.replace(/^sz-/, '')}
          </Text>
          {group.lokalitet && (
            <Badge colorPalette="blue" size="sm">
              Lokalitet
            </Badge>
          )}
          {!group.lokalitet && group.sikringssoner.length > 0 && (
            <Badge colorPalette="yellow" size="sm">
              Sikringssone
            </Badge>
          )}
        </Flex>
      </Stack>

      <Stack gap={1}>
        {artKategori && <FieldRow label="Kategori" value={artKategori} />}
        {beliggenhet && <FieldRow label="Beliggenhet" value={beliggenhet} />}
        {vernetype && (
          <FieldRow
            label="Vernestatus"
            value={vernedato ? `${vernetype} (${vernedato})` : vernetype}
          />
        )}
        {datering && <FieldRow label="Datering" value={datering} />}
        {antall && <FieldRow label="Enkeltminner totalt" value={antall} />}
      </Stack>

      {(() => {
        // If we have a lokalitet, all enkeltminner nest below it. Otherwise
        // the first enkeltminne IS the primary card, so nest the remaining.
        const nested = group.lokalitet
          ? group.enkeltminner
          : group.enkeltminner.slice(1);
        return nested.length > 0 ? (
          <NestedEnkeltminner features={nested} />
        ) : null;
      })()}

      {informasjon && (
        <Box mt={3}>
          <Button
            onClick={() => setDescOpen((v) => !v)}
            variant="tertiary"
            size="xs"
          >
            {descOpen ? 'Skjul beskrivelse' : 'Vis beskrivelse'}
          </Button>
          {descOpen && (
            <Text
              fontSize="sm"
              mt={2}
              whiteSpace="pre-wrap"
              wordBreak="break-word"
              color="gray.700"
            >
              {informasjon}
            </Text>
          )}
        </Box>
      )}

      {(askeladden || kulturminnesok) && (
        <Flex gap={3} mt={3} wrap="wrap">
          {askeladden && (
            <Link
              href={askeladden}
              target="_blank"
              rel="noopener noreferrer"
              fontSize="sm"
              color="blue.600"
              textDecoration="underline"
            >
              Askeladden ↗
            </Link>
          )}
          {kulturminnesok && (
            <Link
              href={kulturminnesok}
              target="_blank"
              rel="noopener noreferrer"
              fontSize="sm"
              color="blue.600"
              textDecoration="underline"
            >
              Kulturminnesøk ↗
            </Link>
          )}
        </Flex>
      )}
    </Box>
  );
};

const PopupContent = ({
  groups,
  onClose,
  onShowMore,
}: {
  groups: HeritageGroup[];
  onClose: () => void;
  onShowMore: () => void;
}) => {
  return (
    <Box
      bg="white"
      borderRadius="12px"
      boxShadow="0 4px 12px rgba(0,0,0,0.2)"
      p={3}
      w="90vw"
      maxW="420px"
      maxH="60vh"
      overflowY="auto"
      overflowX="hidden"
      pointerEvents="auto"
    >
      <Flex justify="space-between" align="center" mb={2} gap={2}>
        <Text fontWeight="bold" fontSize="sm" flex="1" wordBreak="break-word">
          Kulturminne
          {groups.length > 1 ? ` (${groups.length})` : ''}
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
        {groups.map((g) => (
          <HeritageCard key={g.key} group={g} />
        ))}
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

  const groups = groupFeatures(popup.layers);

  return createPortal(
    <PopupContent
      groups={groups}
      onClose={() => setPopup(null)}
      onShowMore={handleShowMore}
    />,
    containerRef.current,
  );
};

