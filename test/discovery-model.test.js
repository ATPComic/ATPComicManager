import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryCandidates, shuffleDiscovery, drawDiscovery, normalizeDrawCount } from '../public/discovery-model.js';
import { getThumbnailUrl } from '../public/reader-model.js';

test('draw count is bounded and draws never duplicate candidates or mutate the pool', () => {
  const pool = Array.from({ length: 200 }, (_, index) => index);
  for (const count of [3, 5, 80, 100]) {
    const draw = drawDiscovery(pool, count);
    assert.equal(draw.length, count);
    assert.equal(new Set(draw).size, count);
    assert.ok(draw.every((item) => pool.includes(item)));
  }
  assert.equal(pool[0], 0);
  assert.deepEqual(drawDiscovery([], 3), []);
  assert.equal(drawDiscovery([1, 2], 5).length, 2);
  assert.equal(normalizeDrawCount('invalid'), 3);
  assert.equal(normalizeDrawCount(-5), 1);
  assert.equal(normalizeDrawCount(500), 100);
  assert.equal(normalizeDrawCount(4.9), 4);
});

test('preview URLs retain stable identity while small thumbnail URLs stay unchanged', () => {
  assert.equal(getThumbnailUrl('episode', 2, 'stable', 'preview'), '/api/thumbnail?episodeId=episode&index=2&file=stable&size=preview');
  assert.equal(getThumbnailUrl('episode', 2, 'stable'), '/api/thumbnail?episodeId=episode&index=2&file=stable');
});

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
