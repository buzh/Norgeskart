// Tiles a bbox into WMS-sized sub-requests, fetches them through the
// same-origin /wms/geonorge/* Caddy handlers (so wmscache picks them up),
// and paints each response into a shared per-canvas destination.

import { LidarSource } from './sources';

// Kartverket's WMS caps GetMap size around 4096 pixels per side; we tile
// below that to stay under any per-request limit and to keep individual
// PNG decodes bounded.
export const MAX_TILE_PX = 2048;

// Cap the final canvas so a huge selection + fine resolution can't
// allocate a 500 MB browser canvas.
export const MAX_CANVAS_PX_PER_SIDE = 12000;

export type TilePlan = {
  widthPx: number;
  heightPx: number;
  tiles: Array<{
    dx: number; // canvas x offset
    dy: number; // canvas y offset
    w: number; // pixel width
    h: number; // pixel height
    bbox25833: [number, number, number, number];
  }>;
};

// Build the tile grid for a given source bbox + resolution. The bbox is in
// EPSG:25833. widthPx / heightPx are the final canvas dimensions.
export function planTiles(
  bbox: [number, number, number, number],
  metresPerPx: number,
): TilePlan {
  const [minX, minY, maxX, maxY] = bbox;
  const worldWidthM = maxX - minX;
  const worldHeightM = maxY - minY;

  let widthPx = Math.max(1, Math.round(worldWidthM / metresPerPx));
  let heightPx = Math.max(1, Math.round(worldHeightM / metresPerPx));

  // Enforce the per-canvas cap by scaling both axes together so we keep
  // aspect ratio. The effective resolution the caller ends up with is
  // metresPerPx / scale.
  const scale = Math.min(
    1,
    MAX_CANVAS_PX_PER_SIDE / Math.max(widthPx, heightPx),
  );
  widthPx = Math.max(1, Math.round(widthPx * scale));
  heightPx = Math.max(1, Math.round(heightPx * scale));

  const effectiveMetresPerPx = worldWidthM / widthPx;

  const cols = Math.ceil(widthPx / MAX_TILE_PX);
  const rows = Math.ceil(heightPx / MAX_TILE_PX);
  const baseTileW = Math.ceil(widthPx / cols);
  const baseTileH = Math.ceil(heightPx / rows);

  const tiles: TilePlan['tiles'] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = c * baseTileW;
      const dy = r * baseTileH;
      const w = Math.min(baseTileW, widthPx - dx);
      const h = Math.min(baseTileH, heightPx - dy);
      // Convert canvas pixels → world metres. Y grows downward in canvas
      // space but northing grows upward, so flip when computing bbox.
      const tileMinX = minX + dx * effectiveMetresPerPx;
      const tileMaxX = tileMinX + w * effectiveMetresPerPx;
      const tileMaxY = maxY - dy * effectiveMetresPerPx;
      const tileMinY = tileMaxY - h * effectiveMetresPerPx;
      tiles.push({
        dx,
        dy,
        w,
        h,
        bbox25833: [tileMinX, tileMinY, tileMaxX, tileMaxY],
      });
    }
  }
  return { widthPx, heightPx, tiles };
}

export function buildGetMapUrl(
  source: LidarSource,
  style: string,
  bbox: [number, number, number, number],
  widthPx: number,
  heightPx: number,
): string {
  // 25833 is a projected CRS so BBOX order is minX,minY,maxX,maxY (E/N).
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: `${source.layerPrefix}:${style}`,
    STYLES: '',
    CRS: 'EPSG:25833',
    BBOX: bbox.join(','),
    WIDTH: String(widthPx),
    HEIGHT: String(heightPx),
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
  });
  return `${source.wmsUrl}?${params.toString()}`;
}

// Concurrency-limited fetch pool: run up to `limit` promises at a time,
// invoke `onSettled` after each one resolves/rejects.
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queue = items.map((item, index) => ({ item, index }));
  const workers = Array.from({ length: Math.min(limit, queue.length) }, () =>
    (async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;
        try {
          await worker(next.item, next.index);
        } catch {
          // Swallow: the worker is responsible for surfacing its own errors
          // via the callback path (status atom / progress notification).
        }
      }
    })(),
  );
  await Promise.all(workers);
}

export type TileResult = 'painted' | 'blank';

// Kartverket's per-project WMS often returns a valid PNG of the requested
// size but filled with a single uniform colour when the request lands
// outside the project's actual coverage. Byte-size heuristics don't catch
// these (a 2048² uniform PNG is ~16 KB, well above trivial-empty thresholds),
// so we downsample-and-check for pixel variance instead: a 16×16 sample
// of a truly uniform tile stays uniform; anything with real hillshade
// content varies at that scale.
export async function fetchAndPaint(
  url: string,
  ctx: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  signal?: AbortSignal,
): Promise<TileResult> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    if (isUniformImage(img)) return 'blank';
    ctx.drawImage(img, dx, dy, dw, dh);
    return 'painted';
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = url;
  });
}

function isUniformImage(img: HTMLImageElement): boolean {
  // Downsample to 16×16 in an offscreen canvas: cheap to read back and
  // still averages across enough of the source that any real terrain
  // detail shows up as variance.
  const sampleSize = 16;
  const oc = document.createElement('canvas');
  oc.width = sampleSize;
  oc.height = sampleSize;
  const octx = oc.getContext('2d', { willReadFrequently: true });
  if (!octx) return false;
  octx.drawImage(img, 0, 0, sampleSize, sampleSize);
  const data = octx.getImageData(0, 0, sampleSize, sampleSize).data;
  const r0 = data[0];
  const g0 = data[1];
  const b0 = data[2];
  const a0 = data[3];
  for (let i = 4; i < data.length; i += 4) {
    if (
      data[i] !== r0 ||
      data[i + 1] !== g0 ||
      data[i + 2] !== b0 ||
      data[i + 3] !== a0
    ) {
      return false;
    }
  }
  return true;
}
