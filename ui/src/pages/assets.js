let database;
function open() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('atp-comic-pages-assets-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function assetStore(key, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', value === undefined ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('assets');
    const request = value === undefined ? store.get(key) : store.put(value, key);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function pruneAssets(retained) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', 'readwrite');
    const request = transaction.objectStore('assets').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!retained.has(cursor.key)) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function storeAssetEntries(entries, preserveThumbnails = false) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', 'readwrite');
    const store = transaction.objectStore('assets');
    for (const [key, value] of entries) {
      if (!preserveThumbnails) store.put(value, key);
      else {
        const request = store.get(key);
        request.onsuccess = () => store.put({ ...value, thumbnails: request.result?.thumbnails }, key);
      }
    }
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function authorizePagesDirectory() {
  const root = await assetStore('directory');
  if (!root) return false;
  return await root.queryPermission({ mode: 'read' }) === 'granted'
    || await root.requestPermission({ mode: 'read' }) === 'granted';
}
