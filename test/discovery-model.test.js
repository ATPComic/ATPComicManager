import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryCandidates, shuffleDiscovery } from '../public/discovery-model.js';

const library = { episodes: {
  first: { files: [
    { name: 'unassigned.png', assignments: [] },
    { name: '20250101_a1.png', assetKey: 'stable', assignments: [{ variant: 'a', pageNumber: 1 }] },
    { name: 'missing.png', missing: true }
  ] },
  second: { files: [{ name: 'other.png', assignments: [] }] },
  empty: { files: [] },
  missing: { files: [{ name: 'missing.png', missing: true }] }
} };
const tags = { categories: [], episodeTags: { first: { subject: ['cat'], mood: ['calm'] }, second: { subject: ['dog'] } } };

test('image discovery includes unassigned files once and keeps stable asset references', () => {
  const items = discoveryCandidates(library, tags);
  assert.equal(items.length, 3);
  assert.equal(items[0].readable, false);
  assert.equal(items[1].file.assetKey, 'stable');
  assert.equal(items[1].index, 1);
  assert.equal(items[1].readable, true);
});

test('covers select one available image per episode, preferring readable images', () => {
  const items = discoveryCandidates(library, tags, {}, 'covers');
  assert.deepEqual(items.map(({ episodeId, index }) => [episodeId, index]), [['first', 1], ['second', 0]]);
});

test('discovery reuses OR within categories and AND between categories', () => {
  assert.equal(discoveryCandidates(library, tags, { subject: ['cat', 'dog'] }).length, 3);
  assert.equal(discoveryCandidates(library, tags, { subject: ['cat', 'dog'], mood: ['calm'] }).length, 2);
  assert.equal(discoveryCandidates(library, tags, { subject: ['unknown'] }).length, 0);
  assert.deepEqual(discoveryCandidates({}, {}), []);
});

test('shuffle preserves every candidate exactly once without mutating the source', () => {
  const original = [1, 2, 3, 4];
  const result = shuffleDiscovery(original, () => 0);
  assert.deepEqual(original, [1, 2, 3, 4]);
  assert.deepEqual(result, [2, 3, 4, 1]);
  assert.deepEqual([...result].sort(), original);
  assert.deepEqual(shuffleDiscovery([]), []);
});
