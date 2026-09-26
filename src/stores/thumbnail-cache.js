import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createImageQueue, thumbnailProfile } from '../../public/thumbnail-policy.js';

const pendingThumbnails = new Map();
const scheduleConversion = createImageQueue(2);
const clearingCaches = new Map();

function thumbnailKey(sourcePath, stat, width, height, quality) {
  return createHash('sha256').update(`${path.resolve(sourcePath)}\0${stat.size}\0${Math.trunc(stat.mtimeMs)}\0${width}x${height}${quality === 76 ? '' : `\0q${quality}`}`).digest('hex').slice(0, 24);
}

export async function previewCacheInfo(cacheRoot, sourcePaths = [], clear = false) {
  cacheRoot = path.resolve(cacheRoot);
  if (clearingCaches.has(cacheRoot)) await clearingCaches.get(cacheRoot);
  const operation = (async () => {
    if (clear) await Promise.allSettled([...pendingThumbnails].filter(([target]) => path.dirname(target) === cacheRoot).map(([, task]) => task));
    const names = await fs.readdir(cacheRoot, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const targets = new Set(names.filter(entry => entry.isFile() && /^[a-f0-9]{24}\.preview\.webp$/.test(entry.name)).map(entry => entry.name));
    const legacy = new Set(names.filter(entry => entry.isFile() && /^[a-f0-9]{24}\.webp$/.test(entry.name)).map(entry => entry.name));
    const profile = thumbnailProfile('preview');
    const sources = [...new Set(sourcePaths)];
    let index = 0;
    if (legacy.size) await Promise.all(Array.from({ length: Math.min(8, sources.length) }, async () => {
      while (index < sources.length) {
        const source = sources[index++];
        const stat = await fs.stat(source).catch(() => null);
        if (!stat) continue;
        const name = `${thumbnailKey(source, stat, profile.width, profile.height, profile.quality)}.webp`;
        if (legacy.has(name)) targets.add(name);
      }
    }));
    let bytes = 0;
    let count = 0;
    for (const name of targets) {
      const target = path.join(cacheRoot, name);
      const stat = await fs.lstat(target).catch(() => null);
      if (!stat?.isFile()) continue;
      if (clear) await fs.unlink(target);
      bytes += stat.size;
      count++;
    }
    return { bytes, count };
  })();
  if (clear) clearingCaches.set(cacheRoot, operation);
  try { return await operation; }
  finally { if (clearingCaches.get(cacheRoot) === operation) clearingCaches.delete(cacheRoot); }
}

export async function createThumbnailWithSharp(sourcePath, targetPath, options = {}) {
  const defaults = thumbnailProfile('small');
  const width = Number(options.width ?? defaults.width);
  const height = Number(options.height ?? defaults.height);
  await sharp(sourcePath)
    .rotate()
    .resize(width, height, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: options.quality ?? defaults.quality })
    .toFile(targetPath);
}

export async function getThumbnailPath({ sourcePath, cacheRoot, width = 240, height = 160, quality = 76, createThumbnail = createThumbnailWithSharp }) {
  cacheRoot = path.resolve(cacheRoot);
  if (clearingCaches.has(cacheRoot)) await clearingCaches.get(cacheRoot);
  const stat = await fs.stat(sourcePath);
  const cacheKey = thumbnailKey(sourcePath, stat, width, height, quality);
  const preview = thumbnailProfile('preview');
  const isPreview = width === preview.width && height === preview.height && quality === preview.quality;
  const targetPath = path.join(cacheRoot, `${cacheKey}${isPreview ? '.preview' : ''}.webp`);

  try {
    await fs.access(targetPath);
    return targetPath;
  } catch {
    // Generate it below.
  }

  if (!pendingThumbnails.has(targetPath)) {
    const task = (async () => {
      await fs.mkdir(cacheRoot, { recursive: true });
      if (isPreview) {
        try { await fs.rename(path.join(cacheRoot, `${cacheKey}.webp`), targetPath); return targetPath; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const temporaryPath = `${targetPath}.${Date.now()}.tmp.webp`;
      try {
        await scheduleConversion(() => createThumbnail(sourcePath, temporaryPath, { width, height, quality }));
        await fs.rename(temporaryPath, targetPath);
      } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
      }
      return targetPath;
    })().finally(() => pendingThumbnails.delete(targetPath));
    pendingThumbnails.set(targetPath, task);
  }

  return pendingThumbnails.get(targetPath);
}
