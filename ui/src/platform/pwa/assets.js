import { createAssetsDbOpener, PAGES_ASSETS_DB } from '../../../../public/pages-assets-db.js';

let opener;
const open = () => (opener ??= createAssetsDbOpener(indexedDB))();

export async function assetStore(key, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PAGES_ASSETS_DB.store, value === undefined ? 'readonly' : 'readwrite');
    const store = transaction.objectStore(PAGES_ASSETS_DB.store);
    const request = value === undefined ? store.get(key) : store.put(value, key);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function pruneAssets(retained) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PAGES_ASSETS_DB.store, 'readwrite');
    const request = transaction.objectStore(PAGES_ASSETS_DB.store).openCursor();
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

export async function clearAssetStore() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PAGES_ASSETS_DB.store, 'readwrite');
    transaction.objectStore(PAGES_ASSETS_DB.store).clear();
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function storeAssetEntries(entries, preserveThumbnails = false) {
  for (let offset = 0; offset < entries.length; offset += 256) {
    await storeAssetBatch(entries.slice(offset, offset + 256), preserveThumbnails);
  }
}
async function storeAssetBatch(entries, preserveThumbnails) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PAGES_ASSETS_DB.store, 'readwrite');
    const store = transaction.objectStore(PAGES_ASSETS_DB.store);
    for (const [key, value] of entries) {
      if (!preserveThumbnails) store.put(value, key);
      else {
        const request = store.get(key);
        request.onsuccess = () => store.put({ ...request.result, ...value }, key);
      }
    }
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
