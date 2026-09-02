import Map from 'ol/Map';
import { transformExtent } from 'ol/proj';
import { LocalityBbox } from '../api/localities';

// Capture the current map view cropped to a lokalitet's rectangle.
// Standard OL canvas-export recipe: wait for rendercomplete, composite
// every layer canvas (applying each one's CSS transform + opacity), then
// crop to the rectangle∩viewport in CSS pixels. Safe from canvas taint
// because all tile sources are same-origin via the /wms/* proxies.
//
// Resolves null when the rectangle isn't (meaningfully) in view or
// anything else goes wrong — callers alert, nothing throws.
export const captureLocalityScreenshot = (
  map: Map,
  bbox4326: LocalityBbox,
): Promise<Blob | null> =>
  new Promise((resolve) => {
    map.once('rendercomplete', () => {
      try {
        const size = map.getSize();
        if (!size) return resolve(null);
        const projection = map.getView().getProjection().getCode();
        const extent = transformExtent(bbox4326, 'EPSG:4326', projection);
        const topLeft = map.getPixelFromCoordinate([extent[0], extent[3]]);
        const bottomRight = map.getPixelFromCoordinate([extent[2], extent[1]]);
        if (!topLeft || !bottomRight) return resolve(null);

        // Rectangle ∩ viewport, in CSS pixels.
        const sx = Math.max(0, Math.floor(topLeft[0]));
        const sy = Math.max(0, Math.floor(topLeft[1]));
        const ex = Math.min(size[0], Math.ceil(bottomRight[0]));
        const ey = Math.min(size[1], Math.ceil(bottomRight[1]));
        const sw = ex - sx;
        const sh = ey - sy;
        if (sw < 20 || sh < 20) return resolve(null);

        const composite = document.createElement('canvas');
        composite.width = size[0];
        composite.height = size[1];
        const ctx = composite.getContext('2d');
        if (!ctx) return resolve(null);

        const canvases = map
          .getViewport()
          .querySelectorAll<HTMLCanvasElement>(
            '.ol-layer canvas, canvas.ol-layer',
          );
        canvases.forEach((canvas) => {
          if (canvas.width === 0) return;
          const parent = canvas.parentNode as HTMLElement | null;
          const opacity = parent?.style.opacity || canvas.style.opacity;
          ctx.globalAlpha = opacity === '' ? 1 : Number(opacity);
          const backgroundColor = parent?.style.backgroundColor;
          const transform = canvas.style.transform;
          let matrix: number[];
          if (transform) {
            const match = transform.match(/^matrix\(([^(]*)\)$/);
            if (!match) return;
            matrix = match[1].split(',').map(Number);
          } else {
            matrix = [
              parseFloat(canvas.style.width) / canvas.width,
              0,
              0,
              parseFloat(canvas.style.height) / canvas.height,
              0,
              0,
            ];
          }
          ctx.setTransform(
            matrix[0],
            matrix[1],
            matrix[2],
            matrix[3],
            matrix[4],
            matrix[5],
          );
          if (backgroundColor) {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(canvas, 0, 0);
        });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;

        const out = document.createElement('canvas');
        out.width = sw;
        out.height = sh;
        const outCtx = out.getContext('2d');
        if (!outCtx) return resolve(null);
        outCtx.drawImage(composite, sx, sy, sw, sh, 0, 0, sw, sh);
        out.toBlob((blob) => resolve(blob), 'image/png');
      } catch (e) {
        console.warn('[screenshot] capture failed', e);
        resolve(null);
      }
    });
    map.renderSync();
  });
