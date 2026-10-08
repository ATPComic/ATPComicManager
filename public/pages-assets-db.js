// Storage identity shared by the service worker and the page realm. GitHub
// Pages serves the canonical app and any preview subpaths from one origin, so
// IndexedDB, CacheStorage, OPFS and localStorage are namespaced per base path.
// The canonical base and root builds keep their historical names so existing
// data (including desktop and released Pages users) is preserved.
export const PAGES_ASSETS_DB = Object.freeze({
  name: 'atp-comic-pages-assets-v1',
  version: 1,
  store: 'assets'
});

const CANONICAL_PAGES_BASE = '/ATPComicManager/';

export function pagesStorageNamespace(base) {
  const path = new URL(base, 'https://pages.invalid/').pathname;
  if (path === '/' || path === CANONICAL_PAGES_BASE) return '';
  return path.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

export function pagesAssetsDatabaseName(base) {
  const namespace = pagesStorageNamespace(base);
  return namespace ? `${PAGES_ASSETS_DB.name}-${namespace}` : PAGES_ASSETS_DB.name;
}

export function pagesAppCachePrefix(base) {
  const namespace = pagesStorageNamespace(base);
  // The canonical prefix must not be a prefix of a preview cache name, or the
  // canonical service worker would delete the preview cache during activate.
  return namespace ? `atp-pages-${namespace}-app-` : 'atp-pages-app-';
}

export function pagesOpfsPoolName(base) {
  const namespace = pagesStorageNamespace(base);
  return namespace ? `atp-pages-v1-${namespace}` : 'atp-pages-v1';
}

export function pagesOpfsDirectory(base) {
  const namespace = pagesStorageNamespace(base);
  return namespace ? `/atp-comic-pages-v1-${namespace}` : '/atp-comic-pages-v1';
}

export function pagesLocalStorageKey(base, key) {
  const namespace = pagesStorageNamespace(base);
  return namespace ? `${key}::${namespace}` : key;
}

export function createAssetsDbOpener(indexedDB, name = PAGES_ASSETS_DB.name) {
  let database;
  return () => {
    database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, PAGES_ASSETS_DB.version);
      request.onupgradeneeded = () => request.result.createObjectStore(PAGES_ASSETS_DB.store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = null; reject(request.error); };
    });
    return database;
  };
}
