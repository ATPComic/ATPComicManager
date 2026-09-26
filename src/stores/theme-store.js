import { storageFor } from '../storage/database.js';
import { normalizeThemeRecord, normalizeThemeTitle } from '../../public/theme-state.js';

export { mergeSharedThemes, normalizeSharedThemes, normalizeThemeRecord, normalizeThemeTitle } from '../../public/theme-state.js';

export async function loadThemes(databasePath) {
  return storageFor(databasePath).read('themes');
}

export async function saveTheme(databasePath, theme) {
  return storageFor(databasePath).write('theme', normalizeThemeRecord(theme));
}

export async function deleteTheme(databasePath, title) {
  return storageFor(databasePath).deleteTheme(normalizeThemeTitle(title));
}

export async function renameTheme(databasePath, currentTitle, nextTitle) {
  return storageFor(databasePath).renameTheme(normalizeThemeTitle(currentTitle), normalizeThemeTitle(nextTitle));
}
