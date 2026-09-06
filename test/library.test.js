import test from 'node:test';
import assert from 'node:assert/strict';
import { createEpisodeRecord, cloneEpisodeRecord, mergeLibraryInto } from '../src/model/library.js';

function makeEpisode(extra = {}) {
  const episode = createEpisodeRecord({ episodeId: '20240105', source: 'S', layout: 'folder' });
  episode.variants.a.push(1);
  episode.variants.b.push(2);
  episode.variants.c.push(3);
  return { ...episode, ...extra };
}

test('cloneEpisodeRecord preserves all variants including c and peek relations', () => {
  const episode = makeEpisode({ peekRelations: { a: 'c', c: 'b' } });
  const clone = cloneEpisodeRecord(episode);
  assert.deepEqual(clone.variants, { a: [1], b: [2], c: [3] });
  assert.deepEqual(clone.peekRelations, { a: 'c', c: 'b' });
  assert.notEqual(clone.peekRelations, episode.peekRelations);
});

test('mergeLibraryInto preserves c variants and peek relations from a source root', () => {
  const target = createEpisodeRecord({ episodeId: '20240105', source: 'T', layout: 'folder' });
  target.variants.a.push(10);
  target.peekRelations = { a: 'b' };
  const library = {
    episodes: { '20240105': target },
    warnings: []
  };
  const sourceEpisode = makeEpisode({ source: 'S', peekRelations: { b: 'c' } });
  const source = { episodes: { '20240105': sourceEpisode }, warnings: [] };

  mergeLibraryInto(library, source, 'rootA');
  assert.deepEqual(library.episodes['20240105'].variants.a, [10, 1]);
  assert.deepEqual(library.episodes['20240105'].variants.b, [2]);
  assert.deepEqual(library.episodes['20240105'].variants.c, [3]);
  assert.deepEqual(library.episodes['20240105'].peekRelations, { a: 'b', b: 'c' });
});
