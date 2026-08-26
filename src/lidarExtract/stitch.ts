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

// Fetch a single tile and paint it onto the target canvas. Uses an
// off-DOM Image with a blob URL so we don't need to touch document.
export async function fetchAndPaint(
  url: string,
  ctx: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, dx, dy, dw, dh);
        resolve();
      };
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
