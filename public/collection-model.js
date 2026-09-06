import { collectTagBranchIds, flattenTagDefinitions, tagDefinitionChildren } from './tag-model.js';

export const EPISODE_DRAG_TYPE = 'application/x-atp-comic-episode';

export function draggedEpisodeId(transfer, activeId, episodes) {
  // Native image drags carry a URL in text/plain, never an episode identity.
  const id = activeId || transfer?.getData(EPISODE_DRAG_TYPE);
  return typeof id === 'string' && Object.hasOwn(episodes ?? {}, id) ? id : null;
}

export function matchesTagFilter(tagMap, filter, categories = []) {
  if (!filter) return true;
  if (typeof filter === 'object') {
    const active = Object.entries(filter)
      .map(([categoryId, values]) => [categoryId, [...new Set(values ?? [])].filter(Boolean)])
      .filter(([, values]) => values.length);
    if (!active.length) return true;
    const categoryMap = new Map((categories ?? []).map((category) => [category.id, category]));
    return active.every(([categoryId, values]) => {
      const assigned = new Set(tagMap?.[categoryId] ?? []);
      const category = categoryMap.get(categoryId);
      return values.some((valueId) => {
        const branchIds = category ? collectTagBranchIds(category.values, valueId) : [valueId];
        return (branchIds.length ? branchIds : [valueId]).some((id) => assigned.has(id));
      });
    });
  }
  const separator = filter.indexOf('\u001f');
  if (separator < 1) return false;
  const categoryId = filter.slice(0, separator);
  const value = filter.slice(separator + 1);
  return (tagMap?.[categoryId] ?? []).includes(value);
}

export function countTagEpisodes(episodeIds, episodeTags, categories = []) {
  const pathsByCategory = new Map((categories ?? []).map((category) => [
    category.id,
    new Map(flattenTagDefinitions(tagDefinitionChildren(category)).map((definition) => [
      definition.id,
      definition.path.map((part) => part.id)
    ]))
  ]));
  const result = {};
  for (const episodeId of new Set(episodeIds ?? [])) {
    const tags = episodeTags?.[episodeId] ?? {};
    for (const [categoryId, values] of Object.entries(tags)) {
      const counted = new Set();
      const paths = pathsByCategory.get(categoryId);
      for (const valueId of values ?? []) {
        const path = paths?.get(valueId);
        for (const id of path?.length ? path : [valueId]) counted.add(id);
      }
      if (!counted.size) continue;
      result[categoryId] ??= {};
      for (const valueId of counted) {
        result[categoryId][valueId] = (result[categoryId][valueId] ?? 0) + 1;
      }
    }
  }
  return result;
}

export function moveItemToSlot(items, item, dropIndex) {
  const source = [...(items ?? [])];
  const originalIndex = source.indexOf(item);
  if (originalIndex < 0) return source;
  const next = source.filter((value) => value !== item);
  let insertionIndex = Math.max(0, Math.min(source.length, Math.round(Number(dropIndex) || 0)));
  if (originalIndex < insertionIndex) insertionIndex -= 1;
  next.splice(Math.max(0, Math.min(next.length, insertionIndex)), 0, item);
  return next;
}

export function getEpisodeDate(episodeId, episode) {
  const explicit = String(episode?.date ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const match = String(episodeId ?? '').match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function matchesDateFilter(episodeId, episode, filter) {
  const date = getEpisodeDate(episodeId, episode);
  const start = String(filter?.start ?? '');
  const end = String(filter?.end ?? '');
  if (!start && !end) return true;
  if (!date) return false;
  const width = filter?.granularity === 'year' ? 4 : filter?.granularity === 'month' ? 7 : 10;
  const value = date.slice(0, width);
  return (!start || value >= start) && (!end || value <= end);
}

export function compareEpisodesByDate([leftId, left], [rightId, right]) {
  const leftDate = getEpisodeDate(leftId, left);
  const rightDate = getEpisodeDate(rightId, right);
  if (leftDate && rightDate) return leftDate.localeCompare(rightDate) || leftId.localeCompare(rightId);
  if (leftDate) return -1;
  if (rightDate) return 1;
  return String(left?.title ?? leftId).localeCompare(String(right?.title ?? rightId), undefined, { numeric: true });
}
