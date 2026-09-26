// Identity of the IndexedDB store that maps asset keys to file handles and
// cached thumbnails. The service worker and the page open this store from two
// separate realms, so both build their opener from this shared definition.
export const PAGES_ASSETS_DB = Object.freeze({
  name: 'atp-comic-pages-assets-v1',
  version: 1,
  store: 'assets'
});

export function createAssetsDbOpener(indexedDB) {
  let database;
  return () => {
    database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(PAGES_ASSETS_DB.name, PAGES_ASSETS_DB.version);
      request.onupgradeneeded = () => request.result.createObjectStore(PAGES_ASSETS_DB.store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = null; reject(request.error); };
    });
    return database;
  };
}
