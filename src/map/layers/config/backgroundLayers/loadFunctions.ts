import ImageTile from 'ol/ImageTile';
import Tile, { LoadFunction } from 'ol/Tile';

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300;
// The Kartverket LiDAR DTM WMS occasionally returns a tiny transparent PNG
// (~479 bytes) instead of the real ~30–50 KB hillshade render when its
// on-the-fly renderer drops a request. Legitimate no-coverage tiles (ocean,
// outside Norway) return the same tiny response — so we cap retries to
// avoid burning requests on genuinely empty areas.
const BLANK_THRESHOLD_BYTES = 800;

export const makeRetryBlankTileLoadFunction = (opts?: {
  onSettled?: (result: { blank: boolean; failed: boolean }) => void;
}): LoadFunction => {
  const notify = opts?.onSettled;
  return (imageTile: Tile, src: string) => {
    if (!(imageTile instanceof ImageTile)) return;
    const image = imageTile.getImage();
    if (!(image instanceof HTMLImageElement)) return;

    const setBlobSrc = (blob: Blob) => {
      const blobUrl = URL.createObjectURL(blob);
      const revoke = () => URL.revokeObjectURL(blobUrl);
      image.addEventListener('load', revoke, { once: true });
      image.addEventListener('error', revoke, { once: true });
      image.src = blobUrl;
    };

    const fail = () => {
      // Dispatch error so OL marks the tile as failed rather than pending
      // forever — assigning image.src alone wouldn't guarantee an error
      // event.
      image.dispatchEvent(new Event('error'));
    };

    const attemptLoad = async (attempt: number) => {
      try {
        // cache: 'no-store' bypasses the browser HTTP cache so a blank
        // response can't be reused on retry. The upstream nginx cache
        // does the real caching and only stores successful, non-blank
        // responses.
        const response = await fetch(src, { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        if (blob.size < BLANK_THRESHOLD_BYTES && attempt < MAX_RETRIES) {
          setTimeout(
            () => attemptLoad(attempt + 1),
            RETRY_BASE_DELAY_MS * 2 ** attempt,
          );
          return;
        }
        setBlobSrc(blob);
        notify?.({ blank: blob.size < BLANK_THRESHOLD_BYTES, failed: false });
      } catch {
        if (attempt < MAX_RETRIES) {
          setTimeout(
            () => attemptLoad(attempt + 1),
            RETRY_BASE_DELAY_MS * 2 ** attempt,
          );
        } else {
          fail();
          notify?.({ blank: false, failed: true });
        }
      }
    };

    attemptLoad(0);
  };
};

// Backwards-compatible export for layers that don't need tile-outcome
// notifications (e.g. the national LiDAR mosaic).
export const retryBlankTileLoadFunction: LoadFunction =
  makeRetryBlankTileLoadFunction();
