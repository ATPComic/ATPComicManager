import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { createThumbnailWithSharp, getThumbnailPath } from '../src/thumbnail-cache.js';

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
