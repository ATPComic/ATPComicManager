import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadTheme } from './metadata.js';

export function createThemeIndexCache() {
  const cache = new Map();

  return {
    async load(themeFolderPath) {
      const indexPath = path.join(themeFolderPath, '.theme-index.json');
      const stat = await fs.stat(indexPath);
      const cached = cache.get(indexPath);

      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.data;
      }

      const data = await loadTheme(themeFolderPath);
      cache.set(indexPath, { mtimeMs: stat.mtimeMs, data });
      return data;
    },
    clear() {
      cache.clear();
    }
  };
}