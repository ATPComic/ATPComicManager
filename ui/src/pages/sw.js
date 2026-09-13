const APP_CACHE = '__APP_CACHE__';
const APP_FILES = __APP_FILES__;
/* THUMBNAIL_POLICY */
self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(APP_FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('atp-pages-app-') && name !== APP_CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
const pendingPreviews = new Map();
let previewEpoch = 0;
const scheduleImage = createImageQueue(2);
function lazyPreview(db, key, item, source, size = 'small') {
  const epoch = previewEpoch;
  size = size === 'preview' ? 'preview' : 'small';
  const fingerprint = thumbnailFingerprint(source, size);
  const cached = item.thumbnails?.[size];
  if (cached?.fingerprint === fingerprint) return Promise.resolve(cached);
  const taskKey = `${key}:${fingerprint}`;
  if (pendingPreviews.has(taskKey)) return pendingPreviews.get(taskKey);
  const task = scheduleImage(async () => {
    const profile = thumbnailProfile(size);
    const dimensions = imageDimensions(await source.slice(0, 256 * 1024).arrayBuffer());
    const resize = dimensions?.width > 0 && dimensions?.height > 0 ? Math.min(1, profile.width / dimensions.width, profile.height / dimensions.height) : null;
    const bitmap = await createImageBitmap(source, resize ? {
      resizeWidth: Math.max(1, Math.round(dimensions.width * resize)),
      resizeHeight: Math.max(1, Math.round(dimensions.height * resize)), resizeQuality: 'medium'
    } : {});
    let result;
    try {
      const scale = Math.min(1, profile.width / bitmap.width, profile.height / bitmap.height);
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: profile.quality / 100 });
      result = { blob, fingerprint, width: dimensions?.width || bitmap.width, height: dimensions?.height || bitmap.height };
    } finally { bitmap.close(); }
    await new Promise(resolve => {
      const transaction = db.transaction('assets', 'readwrite');
      const store = transaction.objectStore('assets');
      const request = store.get(key);
      request.onsuccess = () => {
        const current = request.result;
        if (current?.handle && (size !== 'preview' || epoch === previewEpoch)) store.put({ handle: current.handle, thumbnails: { ...current.thumbnails, [size]: result } }, key);
      };
      transaction.oncomplete = transaction.onabort = transaction.onerror = resolve;
    });
    return result;
  }, { priority: size === 'small' ? 1 : 0 });
  pendingPreviews.set(taskKey, task);
  task.finally(() => pendingPreviews.delete(taskKey)).catch(() => {});
  return task;
}
async function previewCacheResponse(clear) {
  if (clear) previewEpoch++;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('atp-comic-pages-assets-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const result = await new Promise((resolve, reject) => {
      let bytes = 0;
      let count = 0;
      const transaction = db.transaction('assets', clear ? 'readwrite' : 'readonly');
      const request = transaction.objectStore('assets').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = previewCacheEntry(cursor.value, clear);
        bytes += entry.bytes;
        count += entry.count;
        if (clear && entry.count) cursor.update(entry.value);
        cursor.continue();
      };
      transaction.oncomplete = () => resolve({ bytes, count });
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
    return Response.json(result);
  } finally { db.close(); }
}
async function imageResponse(url) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('atp-comic-pages-assets-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const item = await new Promise((resolve, reject) => {
      const request = db.transaction('assets').objectStore('assets').get(url.searchParams.get('key'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const source = item?.handle ? await item.handle.getFile() : null;
    const size = url.searchParams.get('size');
    if (source && size === 'info') {
      const info = imageDimensions(await source.slice(0, 256 * 1024).arrayBuffer());
      if (info?.width > 0 && info?.height > 0) return Response.json(info);
    }
    const preview = source && size !== 'original' ? await lazyPreview(db, url.searchParams.get('key'), item, source, size) : null;
    if (size === 'info') return Response.json(preview ? { width: preview.width, height: preview.height } : { width: 2, height: 3 });
    const blob = size === 'original' ? source : preview?.blob;
    return blob ? new Response(blob, { headers: { 'content-type': blob.type, 'cache-control': 'no-store' } })
      : (await (await caches.open(APP_CACHE)).match(new URL('missing-image.svg', self.registration.scope))) ?? new Response(null, { status: 404 });
  } catch {
    return (await (await caches.open(APP_CACHE)).match(new URL('missing-image.svg', self.registration.scope))) ?? new Response(null, { status: 404 });
  } finally { db.close(); }
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (url.pathname === new URL('__preview-cache', self.registration.scope).pathname && ['GET', 'DELETE'].includes(event.request.method)) {
    event.respondWith(previewCacheResponse(event.request.method === 'DELETE').catch(() => Response.json({ error: 'pagesStorageError' }, { status: 500 })));
    return;
  }
  if (event.request.method !== 'GET') return;
  if (url.pathname === new URL('__image', self.registration.scope).pathname) {
    event.respondWith(imageResponse(url));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    const key = new URL(event.request.url);
    if (event.request.mode === 'navigate') {
      key.search = '';
      if (key.pathname.endsWith('/')) key.pathname += 'index.html';
    }
    return await cache.match(key.href) ?? fetch(event.request);
  })());
});
