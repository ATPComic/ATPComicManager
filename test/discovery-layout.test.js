import test from 'node:test';
import assert from 'node:assert/strict';
import { imageAspectRatio, prepareDiscoveryLayout } from '../ui/src/discovery-layout.js';

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
