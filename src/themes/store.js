import { storageFor } from '../storage/database.js';
import { normalizeTagMap } from '../tag-store.js';

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
