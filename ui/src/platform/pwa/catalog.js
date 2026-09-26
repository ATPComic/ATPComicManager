import { createEmptyRecognitionState } from '../../../../public/recognition-state.js';

export const schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files(episode TEXT REFERENCES episodes(id) ON DELETE CASCADE, ordinal INTEGER, data TEXT NOT NULL, PRIMARY KEY(episode,ordinal));
CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS episode_tags(episode TEXT REFERENCES episodes(id) ON DELETE CASCADE, category TEXT REFERENCES categories(id) ON DELETE CASCADE, data TEXT NOT NULL, PRIMARY KEY(episode,category));
CREATE TABLE IF NOT EXISTS themes(title TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS theme_episodes(theme TEXT REFERENCES themes(title) ON DELETE CASCADE, episode TEXT REFERENCES episodes(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, PRIMARY KEY(theme,episode));
CREATE TABLE IF NOT EXISTS variants(episode TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, data TEXT NOT NULL);
`;

// A shared JSON file or a stray key must never reach Object.prototype through a
// plain {} lookup, so reject prototype-shaped primary keys at the catalog sink.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isUnsafeKey = value => UNSAFE_KEYS.has(String(value));

export function saveCatalog(db, state) {
  const tables = {
    episodes: ['id', 'data'], categories: ['id', 'ordinal', 'data'], themes: ['title', 'ordinal', 'data'],
    files: ['episode', 'ordinal', 'data'], episode_tags: ['episode', 'category', 'data'],
    theme_episodes: ['theme', 'episode', 'ordinal'], variants: ['episode', 'data'], settings: ['key', 'data']
  };
  const primaryKeys = { files: 2, episode_tags: 2, theme_episodes: 2 };
  const pending = Object.fromEntries(Object.keys(tables).map(table => [table, []]));
  const insert = (table, values) => pending[table].push(values);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [id, episode] of Object.entries(state.library.episodes)) {
      if (isUnsafeKey(id)) continue;
      const { files = [], ...data } = episode;
      insert('episodes', [id, JSON.stringify(data)]);
      files.forEach((file, index) => insert('files', [id, index, JSON.stringify(file)]));
    }
    state.tags.categories.forEach((category, index) => {
      if (isUnsafeKey(category.id)) return;
      insert('categories', [category.id, index, JSON.stringify(category)]);
    });
    for (const [episode, tags] of Object.entries(state.tags.episodeTags ?? {})) {
      if (!state.library.episodes[episode]) continue;
      for (const [category, values] of Object.entries(tags)) {
        if (isUnsafeKey(episode) || isUnsafeKey(category)) continue;
        if (state.tags.categories.some(item => item.id === category)) insert('episode_tags', [episode, category, JSON.stringify(values)]);
      }
    }
    state.themes.forEach((theme, index) => {
      const { episodes = [], ...data } = theme;
      insert('themes', [theme.title, index, JSON.stringify(data)]);
      [...new Set(episodes)].forEach((episode, ordinal) => {
        if (!isUnsafeKey(episode) && state.library.episodes[episode]) insert('theme_episodes', [theme.title, episode, ordinal]);
      });
    });
    const variants = state.variantAssignments;
    for (const [episode, assignments] of Object.entries(variants.episodes ?? {})) {
      if (!isUnsafeKey(episode) && state.library.episodes[episode]) insert('variants', [episode, JSON.stringify(assignments)]);
    }
    const { episodes: _episodes, ...variantMeta } = variants;
    insert('settings', ['variants', JSON.stringify(variantMeta)]);
    insert('settings', ['recognition', JSON.stringify(state.recognition)]);
    for (const [table, columns] of Object.entries(tables)) {
      const keyCount = primaryKeys[table] ?? 1;
      const keys = columns.slice(0, keyCount);
      const identity = values => JSON.stringify(values.slice(0, keyCount));
      const existing = new Map(db.exec({ sql: `SELECT * FROM ${table}`, rowMode: 'object', returnValue: 'resultRows' })
        .map(row => { const values = columns.map(column => row[column]); return [identity(values), values]; }));
      const seen = new Set();
      for (const values of pending[table]) {
        const key = identity(values);
        if (seen.has(key)) throw new Error(`UNIQUE constraint failed: ${table}`);
        seen.add(key);
        const previous = existing.get(key);
        if (!previous || previous.some((value, index) => value !== values[index])) {
          db.exec({ sql: `INSERT INTO ${table} VALUES (${values.map(() => '?').join(',')}) ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${columns.slice(keyCount).map(column => `${column}=excluded.${column}`).join(',')}`, bind: values });
        }
        existing.delete(key);
      }
      for (const values of existing.values()) db.exec({ sql: `DELETE FROM ${table} WHERE ${keys.map(key => `${key}=?`).join(' AND ')}`, bind: values.slice(0, keyCount) });
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function loadCatalog(db) {
  const rows = table => db.exec({ sql: `SELECT * FROM ${table}`, rowMode: 'object', returnValue: 'resultRows' });
  const settings = Object.fromEntries(rows('settings').map(row => [row.key, JSON.parse(row.data)]));
  const episodes = Object.fromEntries(rows('episodes').map(row => [row.id, { ...JSON.parse(row.data), files: [] }]));
  for (const row of rows('files ORDER BY ordinal')) episodes[row.episode].files.push(JSON.parse(row.data));
  const categories = rows('categories ORDER BY ordinal').map(row => JSON.parse(row.data));
  const episodeTags = {};
  for (const row of rows('episode_tags')) {
    if (isUnsafeKey(row.episode) || isUnsafeKey(row.category)) continue;
    (episodeTags[row.episode] ??= {})[row.category] = JSON.parse(row.data);
  }
  const themes = rows('themes ORDER BY ordinal').map(row => ({ ...JSON.parse(row.data), episodes: [] }));
  const themeIndex = new Map(themes.map(theme => [theme.title, theme]));
  for (const row of rows('theme_episodes ORDER BY ordinal')) themeIndex.get(row.theme).episodes.push(row.episode);
  return {
    library: { episodes, warnings: [] }, themes, tags: { version: 3, categories, episodeTags },
    recognition: settings.recognition ?? createEmptyRecognitionState(),
    variantAssignments: { version: 3, peekRelations: {}, ...settings.variants, episodes: Object.fromEntries(rows('variants').map(row => [row.episode, JSON.parse(row.data)])) }
  };
}
