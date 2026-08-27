// The card body rendered when mapTool === 'lidarExtract'. Steps the user
// through: draw a box → pick sources & styles → fetch + stitch → preview
// and download the composed canvases. Each source renders at its native
// ground resolution — no per-run resolution picker.

import { Box, Button, HStack, Icon, Text, VStack } from '@kvib/react';
import { useAtom } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LidarCanvas,
  lidarExtractRunAtom,
  lidarExtractSelectionAtom,
  lidarExtractSourcesAtom,
} from './atoms';
import { cancelExtraction, startExtraction, StylesBySource } from './run';
import {
  enumerateLidarSources,
  LidarSource,
  nativeResolutionMetersPerPx,
} from './sources';
import { MAX_CANVAS_PX_PER_SIDE } from './stitch';
import { useDrawSelection } from './useDrawSelection';

export const LidarExtractPanel = () => {
  const { t } = useTranslation();
  useDrawSelection();
  const [selection, setSelection] = useAtom(lidarExtractSelectionAtom);
  const [sources, setSources] = useAtom(lidarExtractSourcesAtom);
  const [run, setRun] = useAtom(lidarExtractRunAtom);
  const [selectedStyles, setSelectedStyles] = useState<
    Record<string, Set<string>>
  >({});
  const [enumerating, setEnumerating] = useState(false);

  // Enumerate sources whenever the selection changes. Also seeds the
  // "all styles selected" default so the user can Run immediately.
  useEffect(() => {
    if (!selection) {
      setSources(null);
      setSelectedStyles({});
      return;
    }
    let cancelled = false;
    setEnumerating(true);
    enumerateLidarSources(selection.bboxLonLat)
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        const seed: Record<string, Set<string>> = {};
        for (const s of list) seed[s.key] = new Set(s.styles);
        setSelectedStyles(seed);
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

  const drawAgain = () => {
    cancelExtraction();
    setRun(null);
    setSelection(null);
  };

  const canRun = useMemo(() => {
    if (!selection || !sources) return false;
    return sources.some((s) => (selectedStyles[s.key]?.size ?? 0) > 0);
  }, [selection, sources, selectedStyles]);

  const handleRun = () => {
    if (!selection || !sources) return;
    const active = sources.filter(
      (s) => (selectedStyles[s.key]?.size ?? 0) > 0,
    );
    const stylesBySource: StylesBySource = {};
    for (const s of active) {
      stylesBySource[s.key] = Array.from(selectedStyles[s.key] ?? []);
    }
    startExtraction(selection.bbox25833, active, stylesBySource);
  };

  const toggleAllStyles = (source: LidarSource) => {
    setSelectedStyles((prev) => {
      const current = prev[source.key] ?? new Set<string>();
      const next = new Set<string>(current);
      if (source.styles.every((st) => next.has(st))) {
        source.styles.forEach((st) => next.delete(st));
      } else {
        source.styles.forEach((st) => next.add(st));
      }
      return { ...prev, [source.key]: next };
    });
  };

  const toggleStyle = (source: LidarSource, style: string) => {
    setSelectedStyles((prev) => {
      const next = new Set(prev[source.key] ?? []);
      if (next.has(style)) next.delete(style);
      else next.add(style);
      return { ...prev, [source.key]: next };
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

      <Box>
        <Text fontSize="xs" color="gray.600" mb={1}>
          {t('lidarExtract.sources.label')}
        </Text>
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
          <VStack align="stretch" gap={2}>
            {sources.map((source) => (
              <SourceRow
                key={source.key}
                source={source}
                spanM={spanM}
                selectedStyles={selectedStyles[source.key] ?? new Set()}
                onToggleAll={() => toggleAllStyles(source)}
                onToggleStyle={(style) => toggleStyle(source, style)}
              />
            ))}
          </VStack>
        )}
      </Box>

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

      {run && (
        <VStack align="stretch" gap={3} mt={2}>
          <Text fontSize="xs" color="gray.600">
            {t('lidarExtract.results.label')}
          </Text>
          {run.canvases.map((c) => (
            <CanvasPreview key={c.id} canvasData={c} />
          ))}
        </VStack>
      )}
    </VStack>
  );
};

const SourceRow = ({
  source,
  spanM,
  selectedStyles,
  onToggleAll,
  onToggleStyle,
}: {
  source: LidarSource;
  spanM: { w: number; h: number };
  selectedStyles: Set<string>;
  onToggleAll: () => void;
  onToggleStyle: (style: string) => void;
}) => {
  const allSelected = source.styles.every((s) => selectedStyles.has(s));
  const anySelected = source.styles.some((s) => selectedStyles.has(s));
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
      <HStack justify="space-between" mb={1}>
        <HStack gap={2}>
          <input
            type="checkbox"
            aria-label={source.label}
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && anySelected;
            }}
            onChange={onToggleAll}
          />
          <Text fontSize="sm" fontWeight="medium">
            {source.label}
          </Text>
        </HStack>
        <HStack gap={1}>
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
      <Box pl={6}>
        {source.styles.map((style) => (
          <label
            key={style}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              padding: '1px 0',
            }}
          >
            <input
              type="checkbox"
              checked={selectedStyles.has(style)}
              onChange={() => onToggleStyle(style)}
            />
            <span>{style}</span>
          </label>
        ))}
      </Box>
    </Box>
  );
};

const CanvasPreview = ({ canvasData }: { canvasData: LidarCanvas }) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasPreview =
    canvasData.status !== 'noCoverage' && canvasData.status !== 'error';

  useEffect(() => {
    if (!hasPreview) return;
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren(canvasData.canvas);
    canvasData.canvas.style.maxWidth = '100%';
    canvasData.canvas.style.height = 'auto';
    canvasData.canvas.style.display = 'block';
    canvasData.canvas.style.imageRendering = 'auto';
  }, [canvasData.canvas, hasPreview]);

  const download = () => {
    canvasData.canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(canvasData.sourceLabel)}_${
        canvasData.style
      }_${canvasData.widthPx}x${canvasData.heightPx}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, 'image/png');
  };

  const progress =
    canvasData.status === 'done'
      ? t('lidarExtract.status.done')
      : canvasData.status === 'error'
        ? t('lidarExtract.status.error')
        : canvasData.status === 'noCoverage'
          ? t('lidarExtract.status.noCoverage')
          : `${canvasData.tilesDone}/${canvasData.tilesTotal}`;

  const paintedTiles =
    canvasData.tilesDone - canvasData.tilesBlank - canvasData.tilesFailed;

  return (
    <Box borderWidth="1px" borderColor="gray.200" borderRadius="sm" p={2}>
      <HStack justify="space-between" mb={1}>
        <VStack align="start" gap={0}>
          <Text fontSize="sm" fontWeight="medium">
            {canvasData.sourceLabel}
          </Text>
          <Text fontSize="10px" color="gray.500">
            {canvasData.style} · {canvasData.widthPx}×{canvasData.heightPx} px ·
            {' '}
            {canvasData.metresPerPx} m/px
          </Text>
        </VStack>
        <HStack>
          <Text fontSize="xs" color="gray.600">
            {progress}
          </Text>
          {canvasData.status === 'done' && (
            <Button
              size="xs"
              variant="ghost"
              onClick={download}
              leftIcon="download"
              aria-label={t('lidarExtract.actions.download')}
            >
              PNG
            </Button>
          )}
        </HStack>
      </HStack>
      {canvasData.status === 'done' && canvasData.tilesBlank > 0 && (
        <Text fontSize="10px" color="gray.500" mb={1}>
          {t('lidarExtract.status.partial', {
            painted: paintedTiles,
            total: canvasData.tilesTotal,
          })}
        </Text>
      )}
      {canvasData.status === 'error' && canvasData.error && (
        <HStack gap={1} mb={1} color="red.700">
          <Icon icon="warning" />
          <Text fontSize="10px">{canvasData.error}</Text>
        </HStack>
      )}
      {canvasData.status === 'noCoverage' && (
        <Text fontSize="10px" color="gray.500">
          {t('lidarExtract.status.noCoverageDetail')}
        </Text>
      )}
      {hasPreview && <Box ref={containerRef} bg="gray.50" />}
    </Box>
  );
};

function formatMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  return `${m} m`;
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}
