import { getThumbnailUrl } from '../../../public/reader-model.js';

export function imageAspectRatio(width, height) {
  return Number(width) > 0 && Number(height) > 0 && Number.isFinite(Number(width) / Number(height))
    ? Number(width) / Number(height) : 2 / 3;
}

export const DISCOVERY_MAX_COLUMNS = 5;

export const DISCOVERY_COLUMN_GAP = 12;
const MOBILE_COLUMN_GAP = 8;
const MOBILE_MAX_WIDTH = 600;
const COLUMN_TARGET_WIDTH = 220;
const CAPTION_HEIGHT = 32;

export function discoveryColumnCount(width) {
  const available = Number(width);
  if (!Number.isFinite(available) || available <= 0) return 1;
  if (available <= MOBILE_MAX_WIDTH) return 2;
  return Math.max(1, Math.min(DISCOVERY_MAX_COLUMNS, Math.floor((available + DISCOVERY_COLUMN_GAP) / (COLUMN_TARGET_WIDTH + DISCOVERY_COLUMN_GAP))));
}

export function discoveryColumnGap(width) {
  return Number(width) <= MOBILE_MAX_WIDTH ? MOBILE_COLUMN_GAP : DISCOVERY_COLUMN_GAP;
}

export function masonryItemsHeight(item, columnWidth) {
  const ratio = Number(item?.aspectRatio) > 0 ? Number(item.aspectRatio) : 2 / 3;
  return Number(columnWidth) / ratio + CAPTION_HEIGHT;
}

export function masonryColumns(items, columnCount, columnWidth, gap = 0) {
  const count = Math.max(1, Math.floor(Number(columnCount) || 1));
  const columns = Array.from({ length: count }, () => []);
  const heights = new Array(count).fill(0);
  for (const item of items ?? []) {
    let target = 0;
    for (let index = 1; index < count; index += 1) {
      if (heights[index] < heights[target]) target = index;
    }
    columns[target].push(item);
    heights[target] += masonryItemsHeight(item, columnWidth) + gap;
  }
  return columns;
}

// eslint-disable-next-line no-restricted-globals -- same-origin thumbnail info request
export async function prepareDiscoveryLayout(items, { signal, cache = new Map(), fetchInfo = fetch } = {}) {
  let cursor = 0;
  const result = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (cursor < items.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const index = cursor++;
      const item = items[index];
      const url = getThumbnailUrl(item.episodeId, item.index, item.file.assetKey);
      let ratio = cache.get(url);
      if (!ratio) {
        ratio = imageAspectRatio(item.file.width, item.file.height);
        const pagesImage = url.includes('/__image?');
        if ((url.startsWith('/api/thumbnail?') || pagesImage) && !(item.file.width && item.file.height)) {
          try {
            const infoUrl = pagesImage ? url.replace(/([?&])size=[^&]*/, '$1size=info') : url.replace('/api/thumbnail?', '/api/image-info?');
            const timeout = AbortSignal.timeout(5000);
            const response = await fetchInfo(infoUrl, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
            if (!response.ok) throw new Error('Image metadata unavailable');
            const info = await response.json();
            ratio = imageAspectRatio(info.width, info.height);
            if (cache.size >= 4000) cache.delete(cache.keys().next().value);
            cache.set(url, ratio);
          } catch (error) {
            if (signal?.aborted) throw error;
          }
        }
      }
      result[index] = { ...item, aspectRatio: ratio };
    }
  }));
  return result;
}
