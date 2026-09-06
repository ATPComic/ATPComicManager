import path from 'node:path';
import { promises as fs } from 'node:fs';

export function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

async function resolveArchiveRoot(workspaceRoot, explicitArchive) {
  if (explicitArchive) {
    try {
      const stat = await fs.stat(explicitArchive);
      if (stat.isDirectory()) {
        return path.resolve(explicitArchive);
      }
    } catch {
      // Fall through to auto-discovery.
    }
  }

  const defaultArchive = path.join(workspaceRoot, 'Archive');
  try {
    const stat = await fs.stat(defaultArchive);
    if (stat.isDirectory()) {
      return defaultArchive;
    }
  } catch {
    // Continue below.
  }

  return null;
}

export async function resolveWorkspaceConfig(args = {}) {
  const workspaceRoot = path.resolve(String(args.workspace ?? process.cwd()));
  const archiveRoot = await resolveArchiveRoot(workspaceRoot, args.archive ? path.resolve(String(args.archive)) : null);
  const readingRoot = path.resolve(String(args.reading ?? path.join(workspaceRoot, 'Reading')));
  const thumbnailCacheRoot = path.join(workspaceRoot, '.comic-manager-cache', 'thumbnails');

  return {
    workspaceRoot,
    databasePath: path.join(workspaceRoot, 'library.sqlite'),
    archiveRoot,
    readingRoot,
    thumbnailCacheRoot,
    host: String(args.host ?? '127.0.0.1'),
    port: Number(args.port ?? 3000)
  };
}
