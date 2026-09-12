import { getThumbnailUrl } from '../../public/reader-model.js';

export function imageAspectRatio(width, height) {
  return Number(width) > 0 && Number(height) > 0 && Number.isFinite(Number(width) / Number(height))
    ? Number(width) / Number(height) : 2 / 3;
}

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
        if (url.startsWith('/api/thumbnail?')) {
          try {
            const response = await fetchInfo(url.replace('/api/thumbnail?', '/api/image-info?'), { signal });
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
