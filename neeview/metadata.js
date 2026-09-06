import { promises as fs } from 'node:fs';
import path from 'node:path';

export const SUPPORTED_THEME_INDEX_VERSION = 1;

export async function locateThemeIndex(themeFolderPath) {
  return path.join(themeFolderPath, '.theme-index.json');
}

export async function parseThemeIndex(indexPath) {
  const raw = await fs.readFile(indexPath, 'utf8');
  const data = JSON.parse(raw);

  if (data.version !== SUPPORTED_THEME_INDEX_VERSION) {
    throw new Error('Unsupported metadata version.');
  }

  return data;
}

export async function loadTheme(themeFolderPath) {
  const indexPath = await locateThemeIndex(themeFolderPath);
  try {
    return await parseThemeIndex(indexPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('.theme-index.json is missing.');
    }
    throw error;
  }
}

export function getEpisode(themeIndex, episodeId) {
  return themeIndex.episodes?.find((episode) => episode.episode === episodeId) ?? null;
}

export function getVariant(episode, variantName) {
  return episode?.variants?.[variantName] ?? null;
}

export function getPageFile(variantEntries, pageNumber) {
  return variantEntries?.find((entry) => entry.page === pageNumber)?.file ?? null;
}

export function nextEpisode(themeIndex, episodeId) {
  const episodes = themeIndex.episodes ?? [];
  const index = episodes.findIndex((episode) => episode.episode === episodeId);
  if (index < 0 || index >= episodes.length - 1) {
    return null;
  }
  return episodes[index + 1];
}

export function previousEpisode(themeIndex, episodeId) {
  const episodes = themeIndex.episodes ?? [];
  const index = episodes.findIndex((episode) => episode.episode === episodeId);
  if (index <= 0) {
    return null;
  }
  return episodes[index - 1];
}