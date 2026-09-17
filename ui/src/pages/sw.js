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
let assetDatabase;
function openAssets() {
  return assetDatabase ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('atp-comic-pages-assets-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { assetDatabase = null; reject(request.error); };
  });
}
let lastFileError = 0;
const validatedThumbnails = new Map();
function validationTime(key, cached) {
  if (!validatedThumbnails.has(key)) {
    if (validatedThumbnails.size >= 4000) validatedThumbnails.delete(validatedThumbnails.keys().next().value);
    validatedThumbnails.set(key, cached.checkedAt ?? Date.now());
  }
  return validatedThumbnails.get(key);
}
async function readSource(db, key, item) {
  if (!item?.handle) return null;
  try { return await item.handle.getFile(); }
  catch (error) {
    if (!['NotFoundError', 'NotReadableError', 'InvalidStateError'].includes(error.name)) throw error;
    const root = await new Promise((resolve, reject) => {
      const request = db.transaction('assets').objectStore('assets').get('directory');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const parts = key.slice(key.indexOf(':') + 1).split('/');
    if (!root || parts.some(part => !part || part === '.' || part === '..')) throw error;
    let parent = root;
    for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
    const handle = await parent.getFileHandle(parts.at(-1));
    const source = await handle.getFile();
    await new Promise(resolve => {
      const transaction = db.transaction('assets', 'readwrite');
      const store = transaction.objectStore('assets');
      const request = store.get(key);
      request.onsuccess = () => { if (request.result) store.put({ ...request.result, handle }, key); };
      transaction.oncomplete = transaction.onerror = transaction.onabort = resolve;
    });
    return source;
  }
}
async function reportFileError(error) {
  if (Date.now() - lastFileError < 3000) return;
  lastFileError = Date.now();
  for (const client of await self.clients.matchAll()) client.postMessage({ type: 'pages-file-error', name: error.name });
}
function lazyPreview(db, key, item, source, size = 'small') {
  const epoch = previewEpoch;
  size = size === 'preview' ? 'preview' : 'small';
  const fingerprint = thumbnailFingerprint(source, size);
  const cached = item.thumbnails?.[size];
  if (cached?.fingerprint === fingerprint) return Promise.resolve(cached);
  const taskKey = `${key}:${fingerprint}`;
  if (pendingPreviews.has(taskKey)) return pendingPreviews.get(taskKey);
  const task = (async () => {
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
      result = { blob, fingerprint, checkedAt: Date.now(), width: dimensions?.width || bitmap.width, height: dimensions?.height || bitmap.height };
    } finally { bitmap.close(); }
    await new Promise(resolve => {
      const transaction = db.transaction('assets', 'readwrite');
      const store = transaction.objectStore('assets');
      const request = store.get(key);
      request.onsuccess = () => {
        const current = request.result;
        if (current?.handle && (size !== 'preview' || epoch === previewEpoch)) store.put({ ...current, thumbnails: { ...current.thumbnails, [size]: result } }, key);
      };
      transaction.oncomplete = transaction.onabort = transaction.onerror = resolve;
    });
    return result;
  })();
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
  const db = await openAssets();
  let cached;
  try {
    const item = await new Promise((resolve, reject) => {
      const request = db.transaction('assets').objectStore('assets').get(url.searchParams.get('key'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const size = url.searchParams.get('size');
    const validationKey = `${url.searchParams.get('key')}:${size}`;
    cached = item?.thumbnails?.[size];
    if (size === 'info') {
      const info = item?.thumbnails?.small ?? item?.thumbnails?.preview ?? item?.dimensions;
      if (info?.width && info?.height) return Response.json({ width: info.width, height: info.height });
    }
    if (cached?.blob && Date.now() - validationTime(validationKey, cached) < 300000) return new Response(cached.blob, { headers: { 'content-type': cached.blob.type, 'cache-control': 'no-store' } });
    const source = await readSource(db, url.searchParams.get('key'), item);
    if (source && size === 'info') {
      const info = imageDimensions(await source.slice(0, 256 * 1024).arrayBuffer());
      if (info?.width > 0 && info?.height > 0) {
        await new Promise(resolve => {
          const transaction = db.transaction('assets', 'readwrite');
          const store = transaction.objectStore('assets');
          const request = store.get(url.searchParams.get('key'));
          request.onsuccess = () => { if (request.result) store.put({ ...request.result, dimensions: info }, url.searchParams.get('key')); };
          transaction.oncomplete = transaction.onerror = transaction.onabort = resolve;
        });
        return Response.json(info);
      }
    }
    const preview = source && size !== 'original' ? await lazyPreview(db, url.searchParams.get('key'), item, source, size) : null;
    if (preview) {
      validationTime(validationKey, preview);
      validatedThumbnails.set(validationKey, Date.now());
    }
    if (size === 'info') return Response.json(preview ? { width: preview.width, height: preview.height } : { width: 2, height: 3 });
    const blob = size === 'original' ? source : preview?.blob;
    return blob ? new Response(blob, { headers: { 'content-type': blob.type, 'cache-control': 'no-store' } })
      : (await (await caches.open(APP_CACHE)).match(new URL('missing-image.svg', self.registration.scope))) ?? new Response(null, { status: 404 });
  } catch (error) {
    await reportFileError(error);
    if (cached?.blob) return new Response(cached.blob, { headers: { 'content-type': cached.blob.type, 'cache-control': 'no-store' } });
    return new Response(null, { status: ['NotAllowedError', 'SecurityError'].includes(error.name) ? 403 : 503, headers: { 'cache-control': 'no-store' } });
  }
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
    event.respondWith(scheduleImage(() => imageResponse(url), { priority: url.searchParams.get('size') === 'preview' ? 0 : 1, signal: event.request.signal }).catch(() => new Response(null, { status: 503 })));
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
