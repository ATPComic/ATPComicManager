import { matchesTagFilter } from './collection-model.js';
import { parseReaderFile, parseReaderFileAssignments } from './reader-model.js';
import { compareVariantNames, isSpecialVariantName } from './variant-assignment-model.js';

// Variant filters offered by discovery. `a`..`c` is exhaustive only up to the
// familiar letters; anything beyond falls under `all`.
export const DISCOVERY_VARIANT_FILTERS = Object.freeze(['all', 'first', 'last', 'a', 'b', 'c']);

function episodeVariantEdges(assignmentsByIndex) {
  const names = new Set();
  for (const assignments of assignmentsByIndex) {
    for (const assignment of assignments) names.add(assignment.variant);
  }
  // First/last are letter variants (a/b/c/...) when the set has any; special
  // variants only count when a set consists solely of them.
  const letters = [...names].filter((name) => !isSpecialVariantName(name)).sort(compareVariantNames);
  const pool = letters.length ? letters : [...names].sort(compareVariantNames);
  return { first: pool[0] ?? null, last: pool[pool.length - 1] ?? null };
}

function matchesVariant(assignments, filter, edges) {
  if (filter === 'all' || !filter) return true;
  if (filter === 'first') return edges.first != null && assignments.some((item) => item.variant === edges.first);
  if (filter === 'last') return edges.last != null && assignments.some((item) => item.variant === edges.last);
  return assignments.some((item) => item.variant === filter);
}

export function discoveryCandidates(library, tags, filters = {}, mode = 'images', variantFilter = 'all') {
  const items = [];
  for (const [episodeId, episode] of Object.entries(library?.episodes ?? {})) {
    if (!matchesTagFilter(tags?.episodeTags?.[episodeId], filters, tags?.categories ?? [])) continue;
    const files = episode?.files ?? [];
    const assignmentsByIndex = files.map((file, index) => (file ? parseReaderFileAssignments(file, index) : []));
    const edges = episodeVariantEdges(assignmentsByIndex);
    const candidates = files.flatMap((file, index) => {
      if (!file || file.missing) return [];
      const assignments = assignmentsByIndex[index];
      if (!matchesVariant(assignments, variantFilter, edges)) return [];
      return [{ episodeId, index, file, readable: Boolean(parseReaderFile(file, index)) }];
    });
    if (mode === 'covers') {
      const cover = candidates.find((item) => item.readable) ?? candidates[0];
      if (cover) items.push(cover);
    } else for (const item of candidates) items.push(item);
  }
  return items;
}

export function shuffleDiscovery(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function discoverySignature(items) {
  return (items ?? [])
    .map((item) => `${item.episodeId}\u0000${item.index}\u0000${item.file?.assetKey ?? ''}\u0000${item.readable ? 1 : 0}`)
    .sort()
    .join('\u0001');
}
