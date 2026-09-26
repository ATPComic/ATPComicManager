import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createImageQueue, thumbnailFingerprint, thumbnailProfile } from '../public/thumbnail-policy.js';
import { imageDimensions } from '../public/image-dimensions.js';
import { createAssetsDbOpener, PAGES_ASSETS_DB } from '../public/pages-assets-db.js';
import sharp from 'sharp';

test('Pages cache hits require no file access and denied reads report recoverable permissions', async () => {
  let reads = 0;
  const messages = [];
  const blob = new Blob(['preview'], { type: 'image/webp' });
  const records = new Map([
    ['cached', { handle: { getFile() { reads++; throw new DOMException('Denied', 'NotAllowedError'); } }, thumbnails: { preview: { blob, width: 100, height: 200 } } }],
    ['denied', { handle: { getFile() { reads++; throw new DOMException('Denied', 'NotAllowedError'); } } }]
  ]);
  const db = { transaction() { return { objectStore() { return { get(key) {
    const request = { result: records.get(key) };
    queueMicrotask(() => request.onsuccess());
    return request;
  } }; } }; } };
  const context = vm.createContext({
    self: { addEventListener() {}, clients: { async matchAll() { return [{ postMessage: message => messages.push(message) }]; } } },
    __APP_FILES__: [], createImageQueue, thumbnailFingerprint, thumbnailProfile, imageDimensions, createAssetsDbOpener, PAGES_ASSETS_DB,
    URL, Response,
    indexedDB: { open() { const request = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } }
  });
  vm.runInContext(await readFile(new URL('../ui/src/platform/pwa/sw.js', import.meta.url), 'utf8'), context);
  const cached = await context.imageResponse(new URL('https://test/__image?key=cached&size=preview'));
  assert.equal(await cached.text(), 'preview');
  assert.equal(reads, 0);
  const info = await context.imageResponse(new URL('https://test/__image?key=cached&size=info'));
  assert.deepEqual(await info.json(), { width: 100, height: 200 });
  assert.equal(reads, 0);
  const denied = await context.imageResponse(new URL('https://test/__image?key=denied&size=preview'));
  assert.equal(denied.status, 403);
  assert.equal(messages[0].name, 'NotAllowedError');
  assert.equal(reads, 1);
});

test('Pages thumbnails use shared sizes, bounded concurrency, independent caches and invalidation', async () => {
  let decodes = 0;
  let active = 0;
  let peak = 0;
  let closed = 0;
  const writes = [];
  const canvases = [];
  const stored = new Map();
  const context = vm.createContext({
    self: { addEventListener() {} },
    __APP_FILES__: [],
    createImageQueue, thumbnailFingerprint, thumbnailProfile, imageDimensions, createAssetsDbOpener, PAGES_ASSETS_DB,
    async createImageBitmap() {
      decodes++;
      peak = Math.max(peak, ++active);
      return { width: 2000, height: 3000, close() { active--; closed++; } };
    },
    OffscreenCanvas: class {
      constructor(width, height) { canvases.push([width, height]); }
      getContext() { return { drawImage() {} }; }
      async convertToBlob() { return { type: 'image/webp' }; }
    }
  });
  vm.runInContext(await readFile(new URL('../ui/src/platform/pwa/sw.js', import.meta.url), 'utf8'), context);
  assert.equal(decodes, 0);
  const db = { transaction() {
    const transaction = { objectStore() { return {
      get(key) {
        const request = { result: stored.get(key) ?? { handle: {} } };
        queueMicrotask(() => { request.onsuccess(); transaction.oncomplete(); });
        return request;
      },
      put(value, key) { writes.push(value); stored.set(key, value); }
    }; } };
    return transaction;
  } };
  const source = { size: 123, lastModified: 456, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
  const first = context.lazyPreview(db, 'one', { handle: {} }, source);
  const duplicate = context.lazyPreview(db, 'one', { handle: {} }, source);
  assert.equal(first, duplicate);
  await Promise.all([first, context.lazyPreview(db, 'two', { handle: {} }, source)]);
  assert.equal(decodes, 2);
  assert.equal(peak, 2);
  assert.equal(closed, 2);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(value => value.thumbnails.small && value.handle && !('original' in value)));
  assert.deepEqual(canvases[0], [107, 160]);
  await context.lazyPreview(db, 'one', writes[0], source);
  assert.equal(decodes, 2);
  await context.lazyPreview(db, 'one', stored.get('one'), source, 'preview');
  assert.equal(decodes, 3);
  assert.deepEqual(canvases[2], [960, 1440]);
  assert.ok(stored.get('one').thumbnails.small && stored.get('one').thumbnails.preview);
  await context.lazyPreview(db, 'one', writes[0], { ...source, lastModified: 789 });
  assert.equal(decodes, 4);
});

test('image queue prioritizes pending small images and skips cancelled tasks', async () => {
  const schedule = createImageQueue(1);
  const order = [];
  let release;
  const running = schedule(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const preview = schedule(() => order.push('preview'));
  const small = schedule(() => order.push('small'), { priority: 1 });
  const controller = new AbortController();
  const cancelled = schedule(() => assert.fail('cancelled task ran'), { signal: controller.signal });
  controller.abort();
  const rejection = assert.rejects(cancelled, { name: 'AbortError' });
  release();
  await Promise.all([running, preview, small, rejection]);
  assert.deepEqual(order, ['small', 'preview']);
});

test('header dimensions avoid decoding PNG and reject incomplete input', () => {
  const buffer = new ArrayBuffer(24);
  const view = new DataView(buffer);
  view.setUint32(0, 0x89504e47);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, 3200);
  view.setUint32(20, 4800);
  assert.deepEqual(imageDimensions(buffer), { width: 3200, height: 4800 });
  assert.equal(imageDimensions(new ArrayBuffer(1)), null);
});

test('header sizes agree with real encoded images and JPEG EXIF rotation', async () => {
  for (const format of ['png', 'jpeg', 'webp', 'gif']) {
    const encoded = await sharp({ create: { width: 73, height: 121, channels: 3, background: '#ffffff' } }).toFormat(format).toBuffer();
    assert.deepEqual(imageDimensions(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)), { width: 73, height: 121 }, format);
  }
  const rotated = await sharp({ create: { width: 73, height: 121, channels: 3, background: '#ffffff' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  assert.deepEqual(imageDimensions(rotated.buffer.slice(rotated.byteOffset, rotated.byteOffset + rotated.byteLength)), { width: 121, height: 73 });
});
