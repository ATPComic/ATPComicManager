import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const pendingThumbnails = new Map();
const conversionQueue = [];
let activeConversions = 0;
const maximumConcurrentConversions = 2;

function scheduleConversion(task) {
  return new Promise((resolve, reject) => {
    conversionQueue.push({ task, resolve, reject });
    drainConversionQueue();
  });
}

function drainConversionQueue() {
  while (activeConversions < maximumConcurrentConversions && conversionQueue.length) {
    const item = conversionQueue.shift();
    activeConversions += 1;
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        activeConversions -= 1;
        drainConversionQueue();
      });
  }
}

export async function createThumbnailWithSharp(sourcePath, targetPath, options = {}) {
  const width = Number(options.width ?? 240);
  const height = Number(options.height ?? 160);
  await sharp(sourcePath)
    .rotate()
    .resize(width, height, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: options.quality ?? 76 })
    .toFile(targetPath);
}

export async function getThumbnailPath({ sourcePath, cacheRoot, width = 240, height = 160, quality = 76, createThumbnail = createThumbnailWithSharp }) {
  const stat = await fs.stat(sourcePath);
  const cacheKey = createHash('sha256')
    .update(`${path.resolve(sourcePath)}\0${stat.size}\0${Math.trunc(stat.mtimeMs)}\0${width}x${height}${quality === 76 ? '' : `\0q${quality}`}`)
    .digest('hex')
    .slice(0, 24);
  const targetPath = path.join(cacheRoot, `${cacheKey}.webp`);

  try {
    await fs.access(targetPath);
    return targetPath;
  } catch {
    // Generate it below.
  }

  if (!pendingThumbnails.has(targetPath)) {
    const task = (async () => {
      await fs.mkdir(cacheRoot, { recursive: true });
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
