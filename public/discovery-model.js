import { matchesTagFilter } from './collection-model.js';
import { parseReaderFile } from './reader-model.js';

export function discoveryCandidates(library, tags, filters = {}, mode = 'images') {
  const items = [];
  for (const [episodeId, episode] of Object.entries(library?.episodes ?? {})) {
    if (!matchesTagFilter(tags?.episodeTags?.[episodeId], filters, tags?.categories ?? [])) continue;
    const files = (episode.files ?? []).flatMap((file, index) => file && !file.missing
      ? [{ episodeId, index, file, readable: Boolean(parseReaderFile(file, index)) }]
      : []);
    if (mode === 'covers') {
      const cover = files.find((item) => item.readable) ?? files[0];
      if (cover) items.push(cover);
    } else for (const item of files) items.push(item);
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
