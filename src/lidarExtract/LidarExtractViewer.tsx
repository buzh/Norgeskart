// Full-screen results viewer for the LiDAR extract. Opens when the user
// presses "Hent" in the panel. Displays a horizontal strip of thumbnails
// along the top and the currently-selected canvas below at full size.
//
// Interactions:
//   - Left/Right arrow keys cycle the selection.
//   - Escape closes the viewer.
//   - Thumbnails can be drag-reordered so two images can be placed
//     adjacent for quick A/B toggling with the arrow keys.
//
// The source LidarCanvas.canvas element is the actual DOM node we hand
// to the big-view slot (moving it with replaceChildren). Thumbnails have
// their own small canvases that mirror the source at reduced size,
// updated whenever a new tile lands.

import { Box, Button, HStack, IconButton, Text, VStack } from '@kvib/react';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LidarCanvas,
  lidarExtractRunAtom,
  lidarExtractViewerOpenAtom,
} from './atoms';

const THUMB_SIZE = 96;

export const LidarExtractViewer = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(lidarExtractViewerOpenAtom);
  const run = useAtomValue(lidarExtractRunAtom);
  const [order, setOrder] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // IDs the user removed with the Del key. Kept in a Set so the
  // reconcile-order effect doesn't keep re-adding them on the next tile
  // update. Reset when a new run starts.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  // Zoom + pan on the big-view canvas. Reset every time the selection or
  // run changes. Pan is measured in container CSS pixels; transform-origin
  // is centre-centre so the maths matches how the wheel handler keeps the
  // cursor point stable when zooming.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0, dragging: false, startX: 0, startY: 0 });
  const bigViewRef = useRef<HTMLDivElement | null>(null);

  const visibleCanvases = useMemo(() => {
    if (!run) return [] as LidarCanvas[];
    return run.canvases.filter(
      (c) => c.status !== 'noCoverage' && c.status !== 'error',
    );
  }, [run]);

  // Fresh run → wipe local user state (order/deletions/selection/zoom).
  useEffect(() => {
    setOrder([]);
    setDeletedIds(new Set());
    setSelectedIndex(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [run?.runId]);

  // Reconcile the drag-reorderable order with the reality of what's
  // currently visible: drop anything that vanished (source turned out to
  // have no coverage), append anything new that just became visible —
  // except things the user has explicitly deleted.
  useEffect(() => {
    const visibleIds = new Set(visibleCanvases.map((c) => c.id));
    setOrder((prev) => {
      const kept = prev.filter((id) => visibleIds.has(id));
      const keptSet = new Set(kept);
      const added = visibleCanvases
        .map((c) => c.id)
        .filter((id) => !keptSet.has(id) && !deletedIds.has(id));
      return [...kept, ...added];
    });
  }, [visibleCanvases, deletedIds]);

  const orderedCanvases = useMemo(() => {
    const byId = new Map(visibleCanvases.map((c) => [c.id, c] as const));
    return order
      .map((id) => byId.get(id))
      .filter((c): c is LidarCanvas => c != null);
  }, [order, visibleCanvases]);

  const clampedSelected = Math.min(
    Math.max(selectedIndex, 0),
    Math.max(orderedCanvases.length - 1, 0),
  );
  const selected = orderedCanvases[clampedSelected];

  const close = useCallback(() => setOpen(false), [setOpen]);

  // Move the selected source canvas into the big-view slot. Sized via CSS
  // to fit while preserving the aspect ratio. Zoom/pan are applied to the
  // canvas element itself via CSS transform in a separate effect.
  useEffect(() => {
    const container = bigViewRef.current;
    if (!container) return;
    if (!selected) {
      container.replaceChildren();
      return;
    }
    container.replaceChildren(selected.canvas);
    const el = selected.canvas;
    el.style.maxWidth = '100%';
    el.style.maxHeight = '100%';
    el.style.width = 'auto';
    el.style.height = 'auto';
    el.style.display = 'block';
    el.style.margin = '0 auto';
    el.style.transformOrigin = 'center center';
    // Sharper zoom when the user scales up — the browser's default
    // bilinear filter turns hillshade into mush at high zooms.
    el.style.imageRendering = 'pixelated';
  }, [selected]);

  // Apply the current zoom/pan to the canvas transform.
  useEffect(() => {
    if (!selected) return;
    const el = selected.canvas;
    el.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    el.style.cursor = zoom > 1 ? 'grab' : 'default';
  }, [selected, zoom, pan]);

  // Wheel zoom needs a non-passive listener to preventDefault the page
  // scroll; React's synthetic onWheel is passive as of React 17.
  useEffect(() => {
    if (!open) return;
    const el = bigViewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom((prevZoom) => {
        const newZoom = Math.max(1, Math.min(20, prevZoom * factor));
        if (newZoom === prevZoom) return prevZoom;
        setPan((prevPan) => {
          const scale = newZoom / prevZoom;
          return {
            x: cx - (cx - prevPan.x) * scale,
            y: cy - (cy - prevPan.y) * scale,
          };
        });
        return newZoom;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open]);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const onBigViewPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panRef.current = {
      x: pan.x,
      y: pan.y,
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
    };
  };
  const onBigViewPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current.dragging) return;
    const dx = e.clientX - panRef.current.startX;
    const dy = e.clientY - panRef.current.startY;
    setPan({ x: panRef.current.x + dx, y: panRef.current.y + dy });
  };
  const onBigViewPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current.dragging) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    panRef.current.dragging = false;
  };

  const deleteCurrent = useCallback(() => {
    const cur = orderedCanvases[clampedSelected];
    if (!cur) return;
    setDeletedIds((prev) => new Set(prev).add(cur.id));
    setOrder((prev) => prev.filter((id) => id !== cur.id));
    // selectedIndex is left as-is; the clamp on next render moves it if
    // it fell off the end.
  }, [orderedCanvases, clampedSelected]);

  // Keyboard: arrow keys cycle selection, Del removes the current image,
  // Escape closes. Listens in CAPTURE phase on document so we consume the
  // event before OL's KeyboardPan/KeyboardZoom (which are attached to
  // document by the map atom's `keyboardEventTarget`) can pan the map
  // underneath the viewer.
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent, action: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      action();
    };
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          handle(e, close);
          return;
        case 'Delete':
          handle(e, deleteCurrent);
          return;
        case '0':
          handle(e, resetZoom);
          return;
        case 'ArrowLeft':
          if (orderedCanvases.length === 0) return;
          handle(e, () =>
            setSelectedIndex((i) =>
              Math.max(0, Math.min(i, orderedCanvases.length - 1) - 1),
            ),
          );
          return;
        case 'ArrowRight':
          if (orderedCanvases.length === 0) return;
          handle(e, () =>
            setSelectedIndex((i) =>
              Math.min(
                orderedCanvases.length - 1,
                Math.min(i, orderedCanvases.length - 1) + 1,
              ),
            ),
          );
          return;
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () =>
      document.removeEventListener('keydown', onKey, { capture: true });
  }, [open, orderedCanvases.length, close, deleteCurrent, resetZoom]);

  const onThumbDragStart = (id: string, e: React.DragEvent) => {
    // Firefox refuses to fire dragover/drop unless dataTransfer has data.
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(id);
  };
  const onThumbDragEnd = () => setDraggingId(null);
  const onThumbDragOver = (e: React.DragEvent) => {
    if (draggingId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };
  const onThumbDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }
    setOrder((prev) => {
      const fromIdx = prev.indexOf(draggingId);
      const toIdx = prev.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, draggingId);
      // Follow the moved item so arrow-key A/B toggling starts from where
      // the user just placed it.
      setSelectedIndex(toIdx);
      return next;
    });
    setDraggingId(null);
  };

  const download = () => {
    if (!selected) return;
    selected.canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(selected.sourceLabel)}_${
        selected.style
      }_${selected.widthPx}x${selected.heightPx}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, 'image/png');
  };

  if (!open || !run) return null;

  return (
    <Box
      position="fixed"
      inset={0}
      bg="rgba(15, 20, 25, 0.94)"
      color="white"
      zIndex={1000}
      display="flex"
      flexDirection="column"
      onClick={(e) => {
        // Only close on plain background clicks.
        if (e.target === e.currentTarget) close();
      }}
    >
      <HStack
        p={2}
        gap={2}
        overflowX="auto"
        overflowY="hidden"
        borderBottom="1px solid rgba(255,255,255,0.1)"
        bg="rgba(0,0,0,0.35)"
        css={{ scrollbarColor: 'rgba(255,255,255,0.3) transparent' }}
      >
        {orderedCanvases.length === 0 && (
          <Text fontSize="sm" color="whiteAlpha.700" px={2}>
            {t('lidarExtract.viewer.empty')}
          </Text>
        )}
        {orderedCanvases.map((c, i) => (
          <Thumbnail
            key={c.id}
            canvasData={c}
            selected={i === clampedSelected}
            dragging={draggingId === c.id}
            onClick={() => setSelectedIndex(i)}
            onDragStart={(e) => onThumbDragStart(c.id, e)}
            onDragEnd={onThumbDragEnd}
            onDragOver={onThumbDragOver}
            onDrop={() => onThumbDrop(c.id)}
          />
        ))}
      </HStack>

      <HStack
        justify="space-between"
        px={3}
        py={1.5}
        bg="rgba(0,0,0,0.25)"
        borderBottom="1px solid rgba(255,255,255,0.08)"
      >
        <VStack align="start" gap={0}>
          <Text fontSize="sm" fontWeight="medium">
            {selected?.sourceLabel ?? '—'}
          </Text>
          <Text fontSize="10px" color="whiteAlpha.700">
            {selected
              ? `${selected.style} · ${selected.widthPx}×${selected.heightPx} px · ${selected.metresPerPx} m/px`
              : ''}
          </Text>
        </VStack>
        <HStack gap={1}>
          <Text fontSize="xs" color="whiteAlpha.700">
            {orderedCanvases.length > 0
              ? `${clampedSelected + 1} / ${orderedCanvases.length}`
              : ''}
          </Text>
          {zoom !== 1 && (
            <>
              <Text fontSize="xs" color="whiteAlpha.700">
                {zoom.toFixed(1)}×
              </Text>
              <IconButton
                size="xs"
                variant="ghost"
                colorPalette="gray"
                icon="restart_alt"
                aria-label={t('lidarExtract.viewer.resetZoom')}
                onClick={resetZoom}
              />
            </>
          )}
          <Button
            size="xs"
            variant="ghost"
            colorPalette="gray"
            leftIcon="download"
            onClick={download}
            disabled={!selected || selected.status !== 'done'}
          >
            PNG
          </Button>
          <IconButton
            size="xs"
            variant="ghost"
            colorPalette="gray"
            icon="delete"
            aria-label={t('lidarExtract.viewer.delete')}
            onClick={deleteCurrent}
            disabled={!selected}
          />
          <IconButton
            size="xs"
            variant="ghost"
            colorPalette="gray"
            icon="close"
            aria-label={t('lidarExtract.viewer.close')}
            onClick={close}
          />
        </HStack>
      </HStack>

      <Box
        flex={1}
        ref={bigViewRef}
        display="flex"
        alignItems="center"
        justifyContent="center"
        overflow="hidden"
        p={4}
        onPointerDown={onBigViewPointerDown}
        onPointerMove={onBigViewPointerMove}
        onPointerUp={onBigViewPointerUp}
        onDoubleClick={resetZoom}
        style={{ touchAction: 'none' }}
      />
    </Box>
  );
};

const Thumbnail = ({
  canvasData,
  selected,
  dragging,
  onClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  canvasData: LidarCanvas;
  selected: boolean;
  dragging: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) => {
  const thumbRef = useRef<HTMLCanvasElement | null>(null);

  // Re-render the thumbnail whenever a new tile lands on the source
  // canvas. tilesDone changing is the cheapest observable signal for that.
  useEffect(() => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    const ctx = thumb.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, thumb.width, thumb.height);
    if (canvasData.canvas.width === 0 || canvasData.canvas.height === 0) return;
    // Fit inside THUMB_SIZE preserving aspect ratio.
    const srcW = canvasData.canvas.width;
    const srcH = canvasData.canvas.height;
    const scale = Math.min(THUMB_SIZE / srcW, THUMB_SIZE / srcH);
    const dw = Math.max(1, Math.round(srcW * scale));
    const dh = Math.max(1, Math.round(srcH * scale));
    const dx = Math.floor((THUMB_SIZE - dw) / 2);
    const dy = Math.floor((THUMB_SIZE - dh) / 2);
    ctx.drawImage(canvasData.canvas, dx, dy, dw, dh);
  }, [canvasData.canvas, canvasData.tilesDone]);

  const progressPct =
    canvasData.tilesTotal > 0
      ? Math.round((canvasData.tilesDone / canvasData.tilesTotal) * 100)
      : 100;

  return (
    <Box
      as="button"
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      flexShrink={0}
      w={`${THUMB_SIZE + 8}px`}
      p={1}
      borderRadius="md"
      border="2px solid"
      borderColor={
        selected ? 'green.400' : dragging ? 'blue.300' : 'transparent'
      }
      bg={selected ? 'rgba(255,255,255,0.08)' : 'transparent'}
      cursor={dragging ? 'grabbing' : 'grab'}
      opacity={dragging ? 0.5 : 1}
      title={`${canvasData.sourceLabel} · ${canvasData.style}`}
    >
      <Box position="relative" w={`${THUMB_SIZE}px`} h={`${THUMB_SIZE}px`}>
        <canvas
          ref={thumbRef}
          width={THUMB_SIZE}
          height={THUMB_SIZE}
          style={{
            width: `${THUMB_SIZE}px`,
            height: `${THUMB_SIZE}px`,
            background: '#111',
            display: 'block',
          }}
        />
        {canvasData.status !== 'done' && (
          <Box
            position="absolute"
            bottom={0}
            left={0}
            right={0}
            bg="rgba(0,0,0,0.55)"
            fontSize="10px"
            textAlign="center"
            color="white"
          >
            {progressPct}%
          </Box>
        )}
      </Box>
      <Text
        mt={1}
        fontSize="9px"
        color="whiteAlpha.800"
        textAlign="center"
        overflow="hidden"
        whiteSpace="nowrap"
        textOverflow="ellipsis"
      >
        {canvasData.style}
      </Text>
    </Box>
  );
};

function sanitizeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}
