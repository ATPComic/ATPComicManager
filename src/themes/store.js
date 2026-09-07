import { storageFor } from '../storage/database.js';
import { normalizeTagMap, mergeTagMaps } from '../tag-store.js';
import { isValidEpisodeId } from '../../public/variant-assignment-model.js';

function normalizeThemeTitle(value) {
  const title = String(value ?? '').trim();
  if (!title || title === '.' || title === '..' || /[<>:"/\\|?*\u0000-\u001f]/.test(title) || /[. ]$/.test(title)) {
    throw new Error('Theme title contains invalid filename characters.');
  }
  return title;
}


export async function loadThemes(databasePath) {
  return storageFor(databasePath).read('themes');
}

export function normalizeSharedThemes(themes = []) {
  if (!Array.isArray(themes)) throw new Error('Shared themes must be a list');
  return themes.map(theme => {
    if (!Array.isArray(theme?.episodes) || theme.episodes.some(id => !isValidEpisodeId(id))) {
      throw new Error('Shared theme contains invalid episode IDs');
    }
    return { title: normalizeThemeTitle(theme.title), episodes: [...new Set(theme.episodes)], tags: normalizeTagMap(theme.tags) };
  });
}

export function mergeSharedThemes(current, imported) {
  const merged = new Map(current.map(theme => [theme.title, theme]));
  for (const theme of normalizeSharedThemes(imported)) {
    const local = merged.get(theme.title);
    merged.set(theme.title, {
      ...theme,
      episodes: [...new Set([...(local?.episodes ?? []), ...theme.episodes])],
      tags: mergeTagMaps(local?.tags, theme.tags)
    });
  }
  return [...merged.values()];
}

export async function saveTheme(databasePath, theme) {
  return storageFor(databasePath).write('theme', {
    title: normalizeThemeTitle(theme.title),
    episodes: [...new Set(theme.episodes ?? [])],
    tags: normalizeTagMap(theme.tags)
  });
}

export async function deleteTheme(databasePath, title) {
  return storageFor(databasePath).deleteTheme(normalizeThemeTitle(title));
}

export async function renameTheme(databasePath, currentTitle, nextTitle) {
  return storageFor(databasePath).renameTheme(normalizeThemeTitle(currentTitle), normalizeThemeTitle(nextTitle));
}
