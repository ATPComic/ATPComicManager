import test from 'node:test';
import assert from 'node:assert/strict';
import { imageAspectRatio, prepareDiscoveryLayout, masonryColumns, masonryItemsHeight, discoveryColumnCount, discoveryColumnGap } from '../ui/src/lib/discovery-layout.js';
import { setReaderAssetUrlResolver } from '../public/reader-model.js';

test('layout resolves dimensions before rendering and caches stable image identities', async () => {
  let calls = 0;
  const items = [{ episodeId: 'day', index: 0, file: { assetKey: 'key' } }];
  const cache = new Map();
  const fetchInfo = async (url) => {
    calls++;
    assert.equal(url, '/api/image-info?episodeId=day&index=0&file=key');
    return { ok: true, json: async () => ({ width: 1600, height: 900 }) };
  };
  const prepared = await prepareDiscoveryLayout(items, { cache, fetchInfo });
  assert.equal(prepared[0].aspectRatio, 16 / 9);
  assert.equal(items[0].aspectRatio, undefined);
  await prepareDiscoveryLayout(items, { cache, fetchInfo });
  assert.equal(calls, 1);
});

test('failed dimensions use a stable fallback and cancelled preparations stop', async () => {
  const items = [{ episodeId: 'day', index: 0, file: {} }];
  const result = await prepareDiscoveryLayout(items, { fetchInfo: async () => { throw new Error('unavailable'); } });
  assert.equal(result[0].aspectRatio, 2 / 3);
  assert.equal(imageAspectRatio(0, 0), 2 / 3);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareDiscoveryLayout(items, { signal: controller.signal }), { name: 'AbortError' });
});

test('Pages discovery resolves real dimensions under the project base path', async () => {
  setReaderAssetUrlResolver(() => '/ATPComicManager/__image?key=file&size=small');
  try {
    const result = await prepareDiscoveryLayout([{ episodeId: 'day', index: 0, file: {} }], {
      fetchInfo: async url => {
        assert.equal(url, '/ATPComicManager/__image?key=file&size=info');
        return { ok: true, json: async () => ({ width: 1200, height: 800 }) };
      }
    });
    assert.equal(result[0].aspectRatio, 1.5);
  } finally { setReaderAssetUrlResolver(null); }
});

test('column count and gap react to the available width', () => {
  assert.equal(discoveryColumnCount(0), 1);
  assert.equal(discoveryColumnCount(400), 2);
  assert.equal(discoveryColumnCount(800), 3);
  assert.equal(discoveryColumnCount(2400), 5);
  assert.equal(discoveryColumnGap(400), 8);
  assert.equal(discoveryColumnGap(1200), 12);
});

test('masonry fills the shortest column left to right and keeps input order', () => {
  const tall = { id: 'a', aspectRatio: 0.5 };
  const short = (id) => ({ id, aspectRatio: 2 });
  const columns = masonryColumns([tall, short('b'), short('c'), short('d')], 2, 100, 0);
  assert.deepEqual(columns.map((column) => column.map((item) => item.id)), [['a'], ['b', 'c', 'd']]);
});

test('masonry ties fall back to the leftmost column', () => {
  const item = (id) => ({ id, aspectRatio: 1 });
  const columns = masonryColumns([item('a'), item('b'), item('c'), item('d')], 2, 100, 0);
  assert.deepEqual(columns.map((column) => column.map((entry) => entry.id)), [['a', 'c'], ['b', 'd']]);
});

test('masonry growth is incremental so loading more never moves existing items', () => {
  const items = Array.from({ length: 9 }, (_, index) => ({ id: index, aspectRatio: index % 2 ? 2 : 0.5 }));
  const prefix = masonryColumns(items.slice(0, 5), 3, 180, 12);
  const full = masonryColumns(items, 3, 180, 12);
  for (let index = 0; index < prefix.length; index += 1) {
    assert.deepEqual(full[index].slice(0, prefix[index].length), prefix[index]);
  }
  assert.equal(masonryItemsHeight({ aspectRatio: 2 }, 200), 100 + 32);
  assert.equal(masonryItemsHeight({}, 200), 300 + 32);
});
