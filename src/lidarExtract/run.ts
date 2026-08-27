// Orchestrates a single extraction run. Each (source × style) gets its
// own canvas rendered at that source's native ground resolution — the
// national mosaic at 1 m/px, per-project layers at whatever their point
// density supports. Tiles that come back as blank PNGs (see
// BLANK_RESPONSE_THRESHOLD_BYTES) don't get painted; a canvas that ends
// with zero painted tiles is reported as noCoverage so the panel can
// hide its empty preview.

import { getDefaultStore } from 'jotai';
import {
  LidarCanvas,
  LidarExtractRun,
  lidarExtractRunAtom,
} from './atoms';
import { LidarSource, nativeResolutionMetersPerPx } from './sources';
import {
  buildGetMapUrl,
  fetchAndPaint,
  planTiles,
  runWithConcurrency,
} from './stitch';

// Kept modest so a Hent doesn't drown the wmscache→Kartverket keepalive
// pool while regular map tiles are also flowing. Bumping this past ~4
// tends to trigger 502s from wmscache under real map-browsing load.
const MAX_CONCURRENT_TILES = 4;

// Transient 5xx from wmscache / Kartverket during bursts is common; a
// small retry with backoff turns the flakiness into eventual success.
const TILE_MAX_RETRIES = 3;
const TILE_RETRY_BASE_MS = 500;

export type StylesBySource = Record<string, string[]>;

let currentAbort: AbortController | null = null;

export function startExtraction(
  bbox25833: [number, number, number, number],
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
    const metresPerPx = nativeResolutionMetersPerPx(source);
    for (const style of styles) {
      const plan = planTiles(bbox25833, metresPerPx);
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
        metresPerPx,
        widthPx: plan.widthPx,
        heightPx: plan.heightPx,
        canvas,
        tilesTotal: plan.tiles.length,
        tilesDone: 0,
        tilesBlank: 0,
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
    canvases,
    startedAt: Date.now(),
  };
  store.set(lidarExtractRunAtom, run);

  void runWithConcurrency(workItems, MAX_CONCURRENT_TILES, async (item) => {
    if (abort.signal.aborted) return;
    markStatus(runId, item.canvasId, 'fetching');
    let lastErr: unknown;
    for (let attempt = 0; attempt <= TILE_MAX_RETRIES; attempt++) {
      if (abort.signal.aborted) return;
      try {
        const result = await fetchAndPaint(
          item.url,
          item.ctx,
          item.dx,
          item.dy,
          item.dw,
          item.dh,
          abort.signal,
        );
        recordTileDone(runId, item.canvasId, {
          blank: result === 'blank',
          failed: false,
        });
        return;
      } catch (err) {
        lastErr = err;
        if (abort.signal.aborted) return;
        if (attempt < TILE_MAX_RETRIES) {
          await sleep(TILE_RETRY_BASE_MS * 2 ** attempt, abort.signal);
        }
      }
    }
    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    recordTileDone(runId, item.canvasId, {
      blank: false,
      failed: true,
      errorMessage: message,
    });
  });

  return run;
}

export function cancelExtraction(): void {
  currentAbort?.abort();
  currentAbort = null;
}

// Abortable sleep. Rejects immediately if the signal aborts; otherwise
// resolves after `ms`. Wrapped so the retry loop can bail on Cancel.
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener('abort', onAbort);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort);
  });
}

function updateRun(
  runId: number,
  updater: (run: LidarExtractRun) => LidarExtractRun,
) {
  const store = getDefaultStore();
  const current = store.get(lidarExtractRunAtom);
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

type TileOutcome = {
  blank: boolean;
  failed: boolean;
  errorMessage?: string;
};

function recordTileDone(
  runId: number,
  canvasId: string,
  outcome: TileOutcome,
) {
  updateRun(runId, (run) => ({
    ...run,
    canvases: run.canvases.map((c) => {
      if (c.id !== canvasId) return c;
      const tilesDone = c.tilesDone + 1;
      const tilesBlank = c.tilesBlank + (outcome.blank ? 1 : 0);
      const tilesFailed = c.tilesFailed + (outcome.failed ? 1 : 0);
      const finished = tilesDone >= c.tilesTotal;
      let status: LidarCanvas['status'] = c.status;
      let error = c.error;
      if (finished) {
        const painted = tilesDone - tilesBlank - tilesFailed;
        if (tilesFailed === c.tilesTotal) {
          status = 'error';
          error = outcome.errorMessage ?? c.error ?? 'Alle fliser feilet';
        } else if (painted === 0) {
          status = 'noCoverage';
        } else {
          status = 'done';
        }
      }
      return { ...c, tilesDone, tilesBlank, tilesFailed, status, error };
    }),
  }));
}
