// The card body rendered when mapTool === 'lidarExtract'. Steps the user
// through: draw a box → pick styles + sources → fetch + stitch → preview
// and download the composed canvases. Each source renders at its native
// ground resolution — no per-run resolution picker.
//
// Styles are chosen once for the whole run and applied to every enabled
// source that advertises them; sources are enabled/disabled individually.
// This avoids the "uncheck 'skyggerelieff' on every dataset" busywork.

import { Box, Button, HStack, Text, VStack } from '@kvib/react';
import { useAtom, useSetAtom } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  lidarExtractRunAtom,
  lidarExtractSelectionAtom,
  lidarExtractSourcesAtom,
  lidarExtractViewerOpenAtom,
} from './atoms';
import { cancelExtraction, startExtraction, StylesBySource } from './run';
import {
  enumerateLidarSources,
  LidarSource,
  nativeResolutionMetersPerPx,
} from './sources';
import { MAX_CANVAS_PX_PER_SIDE } from './stitch';
import { useDrawSelection } from './useDrawSelection';

// skyggerelieff is the default hillshade every LiDAR source advertises;
// keep it at the top of the style list so the most-common toggle is
// always in the same spot.
const STYLE_ORDER_HEAD = ['skyggerelieff'];

export const LidarExtractPanel = () => {
  const { t } = useTranslation();
  useDrawSelection();
  const [selection, setSelection] = useAtom(lidarExtractSelectionAtom);
  const [sources, setSources] = useAtom(lidarExtractSourcesAtom);
  const [, setRun] = useAtom(lidarExtractRunAtom);
  const setViewerOpen = useSetAtom(lidarExtractViewerOpenAtom);
  const [enabledStyles, setEnabledStyles] = useState<Set<string>>(new Set());
  const [disabledSources, setDisabledSources] = useState<Set<string>>(
    new Set(),
  );
  const [enumerating, setEnumerating] = useState(false);

  // Enumerate sources whenever the selection changes. Seeds "all styles
  // enabled, all sources enabled" so the user can Run immediately.
  useEffect(() => {
    if (!selection) {
      setSources(null);
      setEnabledStyles(new Set());
      setDisabledSources(new Set());
      return;
    }
    let cancelled = false;
    setEnumerating(true);
    enumerateLidarSources(selection.bboxLonLat)
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        const allStyles = new Set<string>();
        for (const s of list) s.styles.forEach((st) => allStyles.add(st));
        setEnabledStyles(allStyles);
        setDisabledSources(new Set());
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      })
      .finally(() => {
        if (!cancelled) setEnumerating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selection, setSources]);

  const allStyles = useMemo(() => sortedStyles(sources ?? []), [sources]);

  const drawAgain = () => {
    cancelExtraction();
    setRun(null);
    setViewerOpen(false);
    setSelection(null);
  };

  const canRun = useMemo(() => {
    if (!selection || !sources || sources.length === 0) return false;
    return sources.some(
      (s) =>
        !disabledSources.has(s.key) &&
        s.styles.some((st) => enabledStyles.has(st)),
    );
  }, [selection, sources, enabledStyles, disabledSources]);

  const handleRun = () => {
    if (!selection || !sources) return;
    const stylesBySource: StylesBySource = {};
    const active: LidarSource[] = [];
    for (const s of sources) {
      if (disabledSources.has(s.key)) continue;
      const styles = s.styles.filter((st) => enabledStyles.has(st));
      if (styles.length === 0) continue;
      stylesBySource[s.key] = styles;
      active.push(s);
    }
    startExtraction(selection.bbox25833, active, stylesBySource);
    setViewerOpen(true);
  };

  const toggleStyle = (style: string) => {
    setEnabledStyles((prev) => {
      const next = new Set(prev);
      if (next.has(style)) next.delete(style);
      else next.add(style);
      return next;
    });
  };

  const toggleSource = (sourceKey: string) => {
    setDisabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceKey)) next.delete(sourceKey);
      else next.add(sourceKey);
      return next;
    });
  };

  const spanM = selection
    ? {
        w: Math.round(selection.bbox25833[2] - selection.bbox25833[0]),
        h: Math.round(selection.bbox25833[3] - selection.bbox25833[1]),
      }
    : null;

  if (!selection) {
    return (
      <VStack align="stretch" gap={3}>
        <Text fontSize="sm">
          {t('lidarExtract.instructions.drawBox')}
        </Text>
        <Text fontSize="xs" color="gray.500">
          {t('lidarExtract.instructions.drawHint')}
        </Text>
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={3}>
      <Box>
        <Text fontSize="xs" color="gray.600">
          {t('lidarExtract.selection.label')}
        </Text>
        <Text fontSize="sm">
          {spanM
            ? `${formatMeters(spanM.w)} × ${formatMeters(spanM.h)}`
            : ''}
        </Text>
      </Box>

      {enumerating && (
        <Text fontSize="xs" color="gray.500">
          {t('lidarExtract.sources.loading')}
        </Text>
      )}

      {!enumerating && sources && sources.length === 0 && (
        <Text fontSize="xs" color="gray.500">
          {t('lidarExtract.sources.none')}
        </Text>
      )}

      {!enumerating && sources && sources.length > 0 && spanM && (
        <>
          <Box>
            <Text fontSize="xs" color="gray.600" mb={1}>
              {t('lidarExtract.styles.label')}
            </Text>
            <VStack align="stretch" gap={0}>
              {allStyles.map((style) => (
                <label
                  key={style}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    padding: '2px 0',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={enabledStyles.has(style)}
                    onChange={() => toggleStyle(style)}
                  />
                  <span>{style}</span>
                </label>
              ))}
            </VStack>
          </Box>

          <Box>
            <Text fontSize="xs" color="gray.600" mb={1}>
              {t('lidarExtract.sources.label')}
            </Text>
            <VStack align="stretch" gap={2}>
              {sources.map((source) => (
                <SourceRow
                  key={source.key}
                  source={source}
                  spanM={spanM}
                  enabled={!disabledSources.has(source.key)}
                  onToggle={() => toggleSource(source.key)}
                />
              ))}
            </VStack>
          </Box>
        </>
      )}

      <HStack justify="space-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={drawAgain}
          leftIcon="crop_free"
        >
          {t('lidarExtract.actions.redraw')}
        </Button>
        <Button
          variant="primary"
          colorPalette="green"
          size="sm"
          onClick={handleRun}
          disabled={!canRun}
        >
          {t('lidarExtract.actions.run')}
        </Button>
      </HStack>

    </VStack>
  );
};

const SourceRow = ({
  source,
  spanM,
  enabled,
  onToggle,
}: {
  source: LidarSource;
  spanM: { w: number; h: number };
  enabled: boolean;
  onToggle: () => void;
}) => {
  const mpp = nativeResolutionMetersPerPx(source);
  const rawW = Math.max(1, Math.round(spanM.w / mpp));
  const rawH = Math.max(1, Math.round(spanM.h / mpp));
  const scale = Math.min(1, MAX_CANVAS_PX_PER_SIDE / Math.max(rawW, rawH));
  const outW = Math.round(rawW * scale);
  const outH = Math.round(rawH * scale);
  const capped = scale < 1;
  const effectiveMpp = spanM.w / outW;
  const resLabel = capped
    ? `~${effectiveMpp.toFixed(2)} m/px (kappet)`
    : `~${mpp} m/px`;
  const badges = [
    source.year != null ? String(source.year) : null,
    source.pointDensity,
    resLabel,
    `${outW}×${outH} px`,
  ].filter((x): x is string => x != null);

  return (
    <Box borderWidth="1px" borderColor="gray.200" borderRadius="sm" p={2}>
      <HStack justify="space-between" gap={2}>
        <HStack gap={2} flex={1}>
          <input
            type="checkbox"
            aria-label={source.label}
            checked={enabled}
            onChange={onToggle}
          />
          <Text fontSize="sm" fontWeight="medium">
            {source.label}
          </Text>
        </HStack>
        <HStack gap={1} flexWrap="wrap" justify="flex-end">
          {badges.map((b) => (
            <Text
              key={b}
              fontSize="10px"
              bg="gray.100"
              px={1.5}
              borderRadius="sm"
            >
              {b}
            </Text>
          ))}
        </HStack>
      </HStack>
    </Box>
  );
};

function sortedStyles(sources: LidarSource[]): string[] {
  const all = new Set<string>();
  for (const s of sources) s.styles.forEach((st) => all.add(st));
  const head = STYLE_ORDER_HEAD.filter((s) => all.has(s));
  const rest = Array.from(all)
    .filter((s) => !STYLE_ORDER_HEAD.includes(s))
    .sort();
  return [...head, ...rest];
}

function formatMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  return `${m} m`;
}
