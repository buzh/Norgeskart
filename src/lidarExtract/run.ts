// Orchestrates a single extraction run: for each (source × style), create
// a canvas, tile the bbox, fire fetches through a concurrency pool, and
// update the run atom as tiles finish so the panel can render progress
// and partial previews.

import { getDefaultStore } from 'jotai';
import {
  LidarCanvas,
  LidarExtractRun,
  lidarExtractRunAtom,
} from './atoms';
import { LidarSource } from './sources';
import {
  buildGetMapUrl,
  fetchAndPaint,
  planTiles,
  runWithConcurrency,
} from './stitch';

// Deliberately modest: national + a few projects × several styles each can
// produce dozens of tile fetches. wmscache serialises identical requests
// via proxy_cache_lock, but upstream Kartverket still charges CPU per
// distinct render, so we stay polite.
const MAX_CONCURRENT_TILES = 8;

export type StylesBySource = Record<string, string[]>;

let currentAbort: AbortController | null = null;

// Kick off a new run. Any in-progress run is cancelled first. Returns the
// created run so the caller can display an initial "0/N" state before the
// first tile completes.
export function startExtraction(
  bbox25833: [number, number, number, number],
  resolution: number,
  sources: LidarSource[],
  stylesBySource: StylesBySource,
): LidarExtractRun {
  currentAbort?.abort();
  const abort = new AbortController();
  currentAbort = abort;

  const store = getDefaultStore();
  const runId = Date.now();

  const canvases: LidarCanvas[] = [];
  const workItems: Array<{
    canvasId: string;
    url: string;
    dx: number;
    dy: number;
    dw: number;
    dh: number;
    ctx: CanvasRenderingContext2D;
  }> = [];

  for (const source of sources) {
    const styles = stylesBySource[source.key] ?? [];
    for (const style of styles) {
      const plan = planTiles(bbox25833, resolution);
      const canvas = document.createElement('canvas');
      canvas.width = plan.widthPx;
      canvas.height = plan.heightPx;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      const canvasId = `${source.key}::${style}`;
      canvases.push({
        id: canvasId,
        sourceKey: source.key,
        sourceLabel: source.label,
        style,
        widthPx: plan.widthPx,
        heightPx: plan.heightPx,
        canvas,
        tilesTotal: plan.tiles.length,
        tilesDone: 0,
        tilesFailed: 0,
        status: plan.tiles.length === 0 ? 'done' : 'pending',
      });

      for (const tile of plan.tiles) {
        workItems.push({
          canvasId,
          url: buildGetMapUrl(source, style, tile.bbox25833, tile.w, tile.h),
          dx: tile.dx,
          dy: tile.dy,
          dw: tile.w,
          dh: tile.h,
          ctx,
        });
      }
    }
  }

  const run: LidarExtractRun = {
    runId,
    bbox25833,
    resolution,
    canvases,
    startedAt: Date.now(),
  };
  store.set(lidarExtractRunAtom, run);

  // Fire and forget: the pool completes independently. Progress updates
  // flow through the atom.
  void runWithConcurrency(workItems, MAX_CONCURRENT_TILES, async (item) => {
    if (abort.signal.aborted) return;
    markStatus(runId, item.canvasId, 'fetching');
    try {
      await fetchAndPaint(
        item.url,
        item.ctx,
        item.dx,
        item.dy,
        item.dw,
        item.dh,
        abort.signal,
      );
      recordTileDone(runId, item.canvasId, false);
    } catch (err) {
      if (abort.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      recordTileDone(runId, item.canvasId, true, message);
    }
  });

  return run;
}

export function cancelExtraction(): void {
  currentAbort?.abort();
  currentAbort = null;
}

function updateRun(
  runId: number,
  updater: (run: LidarExtractRun) => LidarExtractRun,
) {
  const store = getDefaultStore();
  const current = store.get(lidarExtractRunAtom);
  // Ignore stale updates from a run the user has since replaced.
  if (!current || current.runId !== runId) return;
  store.set(lidarExtractRunAtom, updater(current));
}

function markStatus(
  runId: number,
  canvasId: string,
  status: LidarCanvas['status'],
) {
  updateRun(runId, (run) => ({
    ...run,
    canvases: run.canvases.map((c) =>
      c.id === canvasId && c.status === 'pending' ? { ...c, status } : c,
    ),
  }));
}

function recordTileDone(
  runId: number,
  canvasId: string,
  failed: boolean,
  errorMessage?: string,
) {
  updateRun(runId, (run) => ({
    ...run,
    canvases: run.canvases.map((c) => {
      if (c.id !== canvasId) return c;
      const tilesDone = c.tilesDone + 1;
      const tilesFailed = c.tilesFailed + (failed ? 1 : 0);
      const finished = tilesDone >= c.tilesTotal;
      let status: LidarCanvas['status'] = c.status;
      let error = c.error;
      if (finished) {
        if (tilesFailed === c.tilesTotal) {
          status = 'error';
          error = errorMessage ?? c.error ?? 'Alle fliser feilet';
        } else {
          status = 'done';
        }
      }
      return { ...c, tilesDone, tilesFailed, status, error };
    }),
  }));
}
