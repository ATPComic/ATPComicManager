import { isValidEpisodeId } from './variant-assignment-model.js';
import { mergeTagMaps, normalizeTagMap } from './tag-state.js';

// Pure theme/collection normalization shared by the Node stores and the
// browser/PWA runtime. Keep this module free of platform imports.

export function normalizeThemeTitle(value) {
  const title = String(value ?? '').trim();
  // Control characters are intentionally rejected in file-safe titles.
  // eslint-disable-next-line no-control-regex
  if (!title || title === '.' || title === '..' || /[<>:"/\\|?*\u0000-\u001f]/.test(title) || /[. ]$/.test(title)) {
    throw new Error('Theme title contains invalid filename characters.');
  }
  return title;
}

export function normalizeThemeRecord(theme) {
  return {
    title: normalizeThemeTitle(theme?.title),
    episodes: [...new Set(theme?.episodes ?? [])],
    tags: normalizeTagMap(theme?.tags)
  };
}

export function normalizeSharedThemes(themes = []) {
  if (!Array.isArray(themes)) throw new Error('Shared themes must be a list');
  return themes.map(theme => {
    if (!Array.isArray(theme?.episodes) || theme.episodes.some(id => !isValidEpisodeId(id))) {
      throw new Error('Shared theme contains invalid episode IDs');
    }
    return normalizeThemeRecord(theme);
  });
}

export function mergeSharedThemes(current, imported) {
  const merged = new Map((current ?? []).map(theme => [theme.title, theme]));
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
