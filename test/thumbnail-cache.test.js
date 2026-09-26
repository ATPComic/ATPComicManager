import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { createThumbnailWithSharp, getThumbnailPath, previewCacheInfo } from '../src/thumbnails/thumbnail-cache.js';
import { previewCacheEntry } from '../public/preview-cache.js';

test('thumbnail cache generates once and reuses the derived image', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-thumbnail-'));
  const sourcePath = path.join(root, 'source.jpg');
  const cacheRoot = path.join(root, 'cache');
  await fs.writeFile(sourcePath, 'original image bytes');
  let generationCount = 0;
  const createThumbnail = async (_source, target) => {
    generationCount += 1;
    await fs.writeFile(target, 'small webp bytes');
  };

  const first = await getThumbnailPath({ sourcePath, cacheRoot, createThumbnail });
  const second = await getThumbnailPath({ sourcePath, cacheRoot, createThumbnail });

  assert.equal(first, second);
  assert.equal(generationCount, 1);
  assert.equal(await fs.readFile(first, 'utf8'), 'small webp bytes');
});

test('preview cache accounting and clearing preserve small thumbnails and originals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-preview-clear-'));
  const sourcePath = path.join(root, 'source.png');
  await fs.writeFile(sourcePath, 'original');
  const options = { sourcePath, cacheRoot: root, createThumbnail: async (_, target) => fs.writeFile(target, 'preview') };
  const small = await getThumbnailPath(options);
  const preview = await getThumbnailPath({ ...options, width: 960, height: 1440, quality: 85 });
  assert.deepEqual(await previewCacheInfo(root, [sourcePath]), { bytes: 7, count: 1 });
  const legacy = preview.replace('.preview.webp', '.webp');
  await fs.rename(preview, legacy);
  assert.deepEqual(await previewCacheInfo(root, [sourcePath]), { bytes: 7, count: 1 });
  await previewCacheInfo(root, [sourcePath], true);
  assert.deepEqual(await previewCacheInfo(root, [sourcePath]), { bytes: 0, count: 0 });
  assert.equal(await fs.readFile(small, 'utf8'), 'preview');
  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'original');
  await assert.rejects(fs.access(legacy));
});

test('Pages preview cleanup keeps small blobs, handles and unrelated data intact', () => {
  const handle = {};
  const small = { blob: new Blob(['small']), fingerprint: 'small' };
  const value = { handle, thumbnails: { small, preview: { blob: new Blob(['preview']) } }, original: new Blob(['original']) };
  const result = previewCacheEntry(value, true);
  assert.equal(result.bytes, 7);
  assert.equal(result.count, 1);
  assert.equal(result.value.handle, handle);
  assert.equal(result.value.thumbnails.small, small);
  assert.equal(result.value.original, value.original);
  assert.equal(result.value.thumbnails.preview, undefined);
  assert.ok(value.thumbnails.preview);
  assert.equal(previewCacheEntry(result.value).bytes, 0);
});

test('medium previews have separate cache entries and retain portrait detail', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-preview-'));
  const sourcePath = path.join(root, 'source.png');
  await sharp({ create: { width: 2000, height: 3000, channels: 3, background: '#336699' } }).png().toFile(sourcePath);
  const options = { sourcePath, cacheRoot: root, width: 960, height: 1440, quality: 85 };
  const medium = await getThumbnailPath(options);
  assert.equal(await getThumbnailPath(options), medium);
  const small = await getThumbnailPath({ sourcePath, cacheRoot: root });
  assert.notEqual(medium, small);
  assert.notEqual(await getThumbnailPath({ ...options, quality: 80 }), medium);
  const metadata = await sharp(medium).metadata();
  assert.equal(metadata.width, 960);
  assert.equal(metadata.height, 1440);
});

test('sharp creates an auto-oriented WebP thumbnail inside the requested bounds', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-thumbnail-sharp-'));
  const sourcePath = path.join(root, 'source.jpg');
  const targetPath = path.join(root, 'thumbnail.webp');
  await sharp({
    create: {
      width: 480,
      height: 640,
      channels: 3,
      background: '#336699'
    }
  }).jpeg().toFile(sourcePath);

  await createThumbnailWithSharp(sourcePath, targetPath, { width: 240, height: 160 });
  const metadata = await sharp(targetPath).metadata();

  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 120);
  assert.equal(metadata.height, 160);
});
