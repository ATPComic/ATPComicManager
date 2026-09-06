const emojiUnit = '(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|\\p{Extended_Pictographic}(?:\\uFE0F|\\uFE0E)?\\p{Emoji_Modifier}?)';
const leadingEmojiPattern = new RegExp(`^(${emojiUnit}(?:\\u200D${emojiUnit})*)\\s*(.+)$`, 'u');
const emojiOnlyPattern = new RegExp(`^(${emojiUnit}(?:\\u200D${emojiUnit})*)$`, 'u');

export function splitLeadingEmoji(value) {
  const text = String(value ?? '').trim();
  const match = text.match(leadingEmojiPattern);
  const emojiOnlyMatch = text.match(emojiOnlyPattern);
  if (emojiOnlyMatch) return { emoji: emojiOnlyMatch[1], name: '' };
  return match
    ? { emoji: match[1], name: match[2].trim() }
    : { emoji: '', name: text };
}

export function normalizeTagDefinition(value) {
  const source = value && typeof value === 'object' ? value : { name: value };
  const parsed = splitLeadingEmoji(source.name);
  const emoji = String(source.emoji ?? parsed.emoji).trim() || parsed.emoji;
  const legacyId = typeof value === 'string' ? String(value).trim() : parsed.name || parsed.emoji || emoji;
  return {
    id: String(source.id ?? legacyId).trim(),
    emoji,
    name: parsed.name
  };
}

export function tagDefinitionChildren(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.values)) return value.values;
  if (Array.isArray(value.children)) return value.children;
  return [];
}

export function flattenTagDefinitions(values, ancestors = []) {
  const result = [];
  for (const value of values ?? []) {
    const definition = normalizeTagDefinition(value);
    if (!definition.id) continue;
    const path = [...ancestors, definition];
    const children = tagDefinitionChildren(value);
    result.push({
      ...definition,
      depth: ancestors.length,
      path
    });
    result.push(...flattenTagDefinitions(children, path));
  }
  return result;
}

export function findTagDefinitionPath(values, valueId) {
  const id = String(valueId ?? '').trim();
  return flattenTagDefinitions(values).find((definition) => definition.id === id)?.path ?? [];
}

export function collectTagBranchIds(values, valueId) {
  const id = String(valueId ?? '').trim();
  if (!id) return [];
  return flattenTagDefinitions(values)
    .filter((definition) => definition.path.some((ancestor) => ancestor.id === id))
    .map((definition) => definition.id);
}

export function getOrderedTagEntries(tagMap, categories) {
  const source = tagMap ?? {};
  const entries = [];
  const knownCategories = new Set();
  for (const category of categories ?? []) {
    knownCategories.add(category.id);
    const selected = new Set(source[category.id] ?? []);
    const knownValues = new Set();
    for (const definition of flattenTagDefinitions(tagDefinitionChildren(category))) {
      knownValues.add(definition.id);
      if (selected.has(definition.id)) {
        entries.push({ categoryId: category.id, valueId: definition.id, path: definition.path });
      }
    }
    for (const valueId of source[category.id] ?? []) {
      if (!knownValues.has(valueId)) entries.push({ categoryId: category.id, valueId, path: [] });
    }
  }
  for (const [categoryId, values] of Object.entries(source)) {
    if (knownCategories.has(categoryId)) continue;
    for (const valueId of values ?? []) entries.push({ categoryId, valueId, path: [] });
  }
  return entries;
}

export function tagValueName(value) {
  return normalizeTagDefinition(value).name;
}

function createTagCatalogIndex(categories) {
  const byCategory = new Map();
  const destinationsById = new Map();
  for (const category of categories ?? []) {
    const definitions = flattenTagDefinitions(tagDefinitionChildren(category));
    const aliases = new Map();
    for (const definition of definitions) {
      aliases.set(definition.id, definition.id);
      if (definition.name) aliases.set(definition.name, definition.id);
      if (definition.emoji) aliases.set(definition.emoji, definition.id);
      if (definition.emoji && definition.name) aliases.set(`${definition.emoji} ${definition.name}`, definition.id);
      const pathLabel = definition.path
        .map((part) => [part.emoji, part.name].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' / ');
      if (pathLabel) aliases.set(pathLabel, definition.id);
      const destinations = destinationsById.get(definition.id) ?? [];
      destinations.push(category.id);
      destinationsById.set(definition.id, destinations);
    }
    byCategory.set(category.id, { ids: new Set(definitions.map((definition) => definition.id)), aliases });
  }
  return { byCategory, destinationsById };
}

export function migrateTagMap(tagMap, categories, renames = {}, previousCategories = []) {
  const current = createTagCatalogIndex(categories);
  const previous = createTagCatalogIndex(previousCategories);
  const result = {};
  const append = (categoryId, valueId) => {
    const values = result[categoryId] ?? [];
    if (!values.includes(valueId)) values.push(valueId);
    result[categoryId] = values;
  };

  for (const [categoryId, values] of Object.entries(tagMap ?? {})) {
    const currentCategory = current.byCategory.get(categoryId);
    const previousCategory = previous.byCategory.get(categoryId);
    for (const value of values ?? []) {
      const renamed = renames[categoryId]?.[value] ?? renames[categoryId]?.[tagValueName(value)] ?? value;
      const text = String(renamed).trim();
      if (!text) continue;

      const sameCategoryId = currentCategory?.aliases.get(text);
      if (sameCategoryId && currentCategory.ids.has(sameCategoryId)) {
        append(categoryId, sameCategoryId);
        continue;
      }

      // Hierarchy edits move the existing node object without changing its id.
      // Resolve legacy labels through the old catalog, then follow that stable id
      // if the node moved to another macro category.
      const stableId = previousCategory?.aliases.get(text) ?? text;
      const destinations = current.destinationsById.get(stableId) ?? [];
      if (destinations.length === 1) append(destinations[0], stableId);
    }
  }
  return result;
}

function findTagNode(nodes, nodeId) {
  for (let index = 0; index < (nodes ?? []).length; index += 1) {
    const node = nodes[index];
    if (String(node?.id) === String(nodeId)) return { nodes, index, node };
    const nested = findTagNode(tagDefinitionChildren(node), nodeId);
    if (nested) return nested;
  }
  return null;
}

function branchContains(node, nodeId) {
  if (!node) return false;
  if (String(node.id) === String(nodeId)) return true;
  return tagDefinitionChildren(node).some((child) => branchContains(child, nodeId));
}

export function relocateTagDefinition(categories, source, target) {
  const sourceCategory = (categories ?? []).find((category) => category.id === source?.categoryId);
  const targetCategory = (categories ?? []).find((category) => category.id === target?.categoryId);
  if (!sourceCategory || !targetCategory || !source?.nodeId) return false;

  const sourceLocation = findTagNode(tagDefinitionChildren(sourceCategory), source.nodeId);
  if (!sourceLocation) return false;
  if (target?.nodeId && branchContains(sourceLocation.node, target.nodeId)) return false;

  const placement = ['before', 'inside', 'after', 'end'].includes(target?.placement)
    ? target.placement
    : 'end';
  const [node] = sourceLocation.nodes.splice(sourceLocation.index, 1);

  if (!target?.nodeId || placement === 'end') {
    if (!Array.isArray(targetCategory.values)) targetCategory.values = [];
    targetCategory.values.push(node);
    return true;
  }

  const targetLocation = findTagNode(tagDefinitionChildren(targetCategory), target.nodeId);
  if (!targetLocation) {
    sourceLocation.nodes.splice(Math.min(sourceLocation.index, sourceLocation.nodes.length), 0, node);
    return false;
  }
  if (placement === 'inside') {
    if (!Array.isArray(targetLocation.node.values)) targetLocation.node.values = [];
    targetLocation.node.values.push(node);
  } else {
    targetLocation.nodes.splice(targetLocation.index + (placement === 'after' ? 1 : 0), 0, node);
  }
  return true;
}
