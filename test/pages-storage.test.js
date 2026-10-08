import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAGES_ASSETS_DB,
  createAssetsDbOpener,
  pagesAppCachePrefix,
  pagesAssetsDatabaseName,
  pagesLocalStorageKey,
  pagesOpfsDirectory,
  pagesOpfsPoolName,
  pagesStorageNamespace
} from '../public/pages-assets-db.js';

test('canonical and root builds keep the historical storage identity', () => {
  for (const base of ['/', '/ATPComicManager/']) {
    assert.equal(pagesStorageNamespace(base), '');
    assert.equal(pagesAssetsDatabaseName(base), 'atp-comic-pages-assets-v1');
    assert.equal(pagesAppCachePrefix(base), 'atp-pages-app-');
    assert.equal(pagesOpfsPoolName(base), 'atp-pages-v1');
    assert.equal(pagesOpfsDirectory(base), '/atp-comic-pages-v1');
    assert.equal(pagesLocalStorageKey(base, 'comic-manager.theme'), 'comic-manager.theme');
  }
});

test('preview subpaths receive isolated storage names', () => {
  const base = '/ATPComicManager/develop/';
  assert.equal(pagesStorageNamespace(base), 'atpcomicmanager-develop');
  assert.equal(pagesAssetsDatabaseName(base), 'atp-comic-pages-assets-v1-atpcomicmanager-develop');
  assert.equal(pagesAppCachePrefix(base), 'atp-pages-atpcomicmanager-develop-app-');
  assert.equal(pagesOpfsPoolName(base), 'atp-pages-v1-atpcomicmanager-develop');
  assert.equal(pagesOpfsDirectory(base), '/atp-comic-pages-v1-atpcomicmanager-develop');
  assert.equal(pagesLocalStorageKey(base, 'comic-manager.theme'), 'comic-manager.theme::atpcomicmanager-develop');
});

test('a preview cache prefix never matches the canonical cache names', () => {
  const canonicalPrefix = pagesAppCachePrefix('/ATPComicManager/');
  const previewPrefix = pagesAppCachePrefix('/ATPComicManager/develop/');
  const canonical = `${canonicalPrefix}abc123`;
  const preview = `${previewPrefix}abc123`;
  assert.equal(canonical, 'atp-pages-app-abc123');
  assert.equal(preview, 'atp-pages-atpcomicmanager-develop-app-abc123');
  assert.equal(preview.startsWith(canonicalPrefix), false);
  assert.equal(canonical.startsWith(previewPrefix), false);
});

test('the assets database opener uses the provided database name', async () => {
  const opened = [];
  const fakeIndexedDb = {
    open(name, version) {
      opened.push([name, version]);
      const request = { result: { name } };
      queueMicrotask(() => request.onsuccess());
      return request;
    }
  };
  const open = createAssetsDbOpener(fakeIndexedDb, 'custom-name');
  assert.equal((await open()).name, 'custom-name');
  assert.deepEqual(opened, [['custom-name', PAGES_ASSETS_DB.version]]);
});
