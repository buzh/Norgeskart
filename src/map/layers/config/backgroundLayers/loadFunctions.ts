import ImageTile from 'ol/ImageTile';
import Tile, { LoadFunction } from 'ol/Tile';
import { getEnv } from '../../../../env';
const env = getEnv();
export const nibTileLoadFunction: LoadFunction = (
  imageTile: Tile,
  src: string,
) => {
  const token = env.layerProviderParameters.norgeIBilder.apiKey;
  if (imageTile instanceof ImageTile) {
    const image = imageTile.getImage();
    if (image instanceof HTMLImageElement) {
      image.src = src + (src.includes('?') ? '&' : '?') + 'token=' + token;
    }
  }
};

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 400;

export const retryTileLoadFunction: LoadFunction = (
  imageTile: Tile,
  src: string,
) => {
  if (!(imageTile instanceof ImageTile)) return;
  const image = imageTile.getImage();
  if (!(image instanceof HTMLImageElement)) return;

  let attempt = 0;
  image.addEventListener('error', () => {
    if (attempt >= MAX_RETRIES) return;
    attempt++;
    const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    setTimeout(() => {
      image.src = src + (src.includes('?') ? '&' : '?') + '_retry=' + attempt;
    }, delay);
  });
  image.src = src;
};
