export const thumbnailProfiles = Object.freeze({
  small: Object.freeze({ width: 240, height: 160, quality: 76 }),
  preview: Object.freeze({ width: 960, height: 1440, quality: 85 })
});

export function thumbnailProfile(size) {
  return thumbnailProfiles[size === 'preview' ? 'preview' : 'small'];
}

export function thumbnailFingerprint(source, size) {
  const { width, height, quality } = thumbnailProfile(size);
  return `${source.size}:${source.lastModified}:${width}:${height}:${quality}:v2`;
}

export function createImageQueue(concurrency = 2) {
  let active = 0;
  const waiting = [];
  function drain() {
    while (active < concurrency && waiting.length) {
      const item = waiting.shift();
      if (item.signal?.aborted) { item.reject(new DOMException('Aborted', 'AbortError')); continue; }
      active++;
      Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => { active--; drain(); });
    }
  }
  return (task, { priority = 0, signal } = {}) => new Promise((resolve, reject) => {
    waiting.push({ task, priority, signal, resolve, reject });
    waiting.sort((a, b) => b.priority - a.priority);
    drain();
  });
}
