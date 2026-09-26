import { flattenTagDefinitions, normalizeTagDefinition, tagDefinitionChildren } from './tag-model.js';

// Pure tag-state normalization shared by the Node stores and the browser/PWA
// runtime so both trust boundaries apply the same rules. Keep this module free
// of platform imports.

export function createEmptyTagState() {
  return { version: 3, categories: [], episodeTags: {} };
}

// Hostile shared JSON can use prototype-shaped ids; drop them at the
// normalization boundary so no plain-object assignment ever touches a prototype.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isUnsafeKey = value => UNSAFE_KEYS.has(String(value));

function normalizeId(value, fallback) {
  const id = String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return id || fallback;
}

export function normalizeCategoryColor(value) {
  const color = typeof value === 'string' ? value : '';
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : undefined;
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))];
}

function uniqueTagDefinitions(values, usedIds = new Set()) {
  const definitions = [];
  for (const value of values ?? []) {
    const definition = normalizeTagDefinition(value);
    if (!definition.id || (!definition.name && !definition.emoji)) continue;
    if (usedIds.has(definition.id)) continue;
    usedIds.add(definition.id);
    definitions.push({
      ...definition,
      values: uniqueTagDefinitions(tagDefinitionChildren(value), usedIds)
    });
  }
  return definitions;
}

export function normalizeTagMap(tags, categoryAliases = new Map()) {
  const result = {};
  for (const [categoryId, values] of Object.entries(tags ?? {})) {
    if (isUnsafeKey(categoryId)) continue;
    const aliases = categoryAliases.get(categoryId);
    const normalized = [...new Set(uniqueStrings(values).map((value) => aliases?.get(value) ?? value))];
    if (normalized.length) result[String(categoryId)] = normalized;
  }
  return result;
}

export function normalizeTagState(value) {
  const categories = [];
  const categoryAliases = new Map();
  const usedIds = new Set();
  for (const [index, category] of (value?.categories ?? []).entries()) {
    const definition = normalizeTagDefinition(category);
    if (!definition.name && !definition.emoji) continue;
    let id = normalizeId(category.id ?? definition.name, `category-${index + 1}`);
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    const values = uniqueTagDefinitions(tagDefinitionChildren(category));
    const color = normalizeCategoryColor(category.color);
    categories.push({
      id,
      name: definition.name,
      emoji: definition.emoji,
      ...(color ? { color } : {}),
      values
    });
    const aliases = new Map();
    for (const value of flattenTagDefinitions(values)) {
      aliases.set(value.id, value.id);
      if (value.name) aliases.set(value.name, value.id);
      if (value.emoji) aliases.set(value.emoji, value.id);
      if (value.emoji && value.name) aliases.set(`${value.emoji} ${value.name}`, value.id);
    }
    categoryAliases.set(id, aliases);
  }
  const episodeTags = {};
  for (const [episodeId, tags] of Object.entries(value?.episodeTags ?? {})) {
    if (isUnsafeKey(episodeId)) continue;
    const normalized = normalizeTagMap(tags, categoryAliases);
    if (Object.keys(normalized).length) episodeTags[episodeId] = normalized;
  }
  return { version: 3, categories, episodeTags };
}

export function mergeTagStates(current, imported) {
  const left = normalizeTagState(current);
  const right = normalizeTagState(imported);
  const categories = [...left.categories];
  const categoryIds = new Set(categories.map((category) => category.id));
  function mergeDefinitions(target, additions) {
    const result = target.map((item) => ({ ...item, values: mergeDefinitions(item.values ?? [], []) }));
    const byId = new Map(result.map((item) => [item.id, item]));
    for (const item of additions) {
      const existing = byId.get(item.id);
      if (existing) existing.values = mergeDefinitions(existing.values ?? [], item.values ?? []);
      else {
        const clone = { ...item, values: mergeDefinitions([], item.values ?? []) };
        result.push(clone);
        byId.set(clone.id, clone);
      }
    }
    return result;
  }
  for (const category of right.categories) {
    if (!categoryIds.has(category.id)) {
      categories.push(category);
      categoryIds.add(category.id);
    } else {
      const existing = categories.find((item) => item.id === category.id);
      existing.values = mergeDefinitions(existing.values ?? [], category.values ?? []);
    }
  }
  const episodeTags = { ...left.episodeTags };
  for (const [episodeId, tags] of Object.entries(right.episodeTags)) {
    episodeTags[episodeId] = mergeTagMaps(episodeTags[episodeId], tags);
  }
  return normalizeTagState({ version: 3, categories, episodeTags });
}

export function mergeTagMaps(target, source) {
  const result = normalizeTagMap(target);
  for (const [categoryId, values] of Object.entries(normalizeTagMap(source))) {
    result[categoryId] = uniqueStrings([...(result[categoryId] ?? []), ...values]);
  }
  return result;
}
