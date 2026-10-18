import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryCandidates, discoverySignature, shuffleDiscovery } from '../public/discovery-model.js';
import { getThumbnailUrl } from '../public/reader-model.js';


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

const variantLibrary = { episodes: {
  standard: { files: [
    { name: '20250101_a1.png', assignments: [{ variant: 'a', pageNumber: 1 }] },
    { name: '20250101_a2.png', assignments: [{ variant: 'a', pageNumber: 2 }] },
    { name: '20250101_b1.png', assignments: [{ variant: 'b', pageNumber: 1 }] },
    { name: '20250101_c1.png', assignments: [{ variant: 'c', pageNumber: 1 }] }
  ] },
  onlyB: { files: [
    { name: '20250102_b1.png', assignments: [{ variant: 'b', pageNumber: 1 }] },
    { name: '20250102_b2.png', assignments: [{ variant: 'b', pageNumber: 2 }] }
  ] },
  ac: { files: [
    { name: '20250103_a1.png', assignments: [{ variant: 'a', pageNumber: 1 }] },
    { name: '20250103_c1.png', assignments: [{ variant: 'c', pageNumber: 1 }] }
  ] },
  special: { files: [
    { name: '20250104_a1.png', assignments: [{ variant: 'a', pageNumber: 1 }] },
    { name: '20250104_b1_sp1.png', assignments: [{ variant: 'b_sp1', pageNumber: 1 }] }
  ] },
  plain: { files: [{ name: 'plain.png', assignments: [] }] }
} };

function variantIds(variantFilter, mode = 'images') {
  return discoveryCandidates(variantLibrary, { categories: [], episodeTags: {} }, {}, mode, variantFilter)
    .map((item) => item.file.name)
    .sort();
}

test('discovery variant filter selects letters without inventing missing ones', () => {
  assert.equal(variantIds('all').length, 11);
  assert.deepEqual(variantIds('a'), ['20250101_a1.png', '20250101_a2.png', '20250103_a1.png', '20250104_a1.png']);
  // `b_sp1` is a special variant, not the letter B.
  assert.deepEqual(variantIds('b'), ['20250101_b1.png', '20250102_b1.png', '20250102_b2.png']);
  assert.deepEqual(variantIds('c'), ['20250101_c1.png', '20250103_c1.png']);
});

test('discovery first/last variant are per episode and robust to missing letters', () => {
  // standard: a..c -> first a, last c; onlyB -> both b; ac -> a/c; special -> a (letters only).
  assert.deepEqual(variantIds('first'), [
    '20250101_a1.png', '20250101_a2.png', '20250102_b1.png', '20250102_b2.png', '20250103_a1.png', '20250104_a1.png'
  ]);
  assert.deepEqual(variantIds('last'), [
    '20250101_c1.png', '20250102_b1.png', '20250102_b2.png', '20250103_c1.png', '20250104_a1.png'
  ]);
});

test('discovery covers honours the variant filter', () => {
  assert.deepEqual(variantIds('c', 'covers'), ['20250101_c1.png', '20250103_c1.png']);
});

test('shuffle preserves every candidate exactly once without mutating the source', () => {
  const original = [1, 2, 3, 4];
  const result = shuffleDiscovery(original, () => 0);
  assert.deepEqual(original, [1, 2, 3, 4]);
  assert.deepEqual(result, [2, 3, 4, 1]);
  assert.deepEqual([...result].sort(), original);
  assert.deepEqual(shuffleDiscovery([]), []);
});

test('discovery signature ignores order but tracks identity and readability changes', () => {
  const first = { episodeId: 'a', index: 0, file: { assetKey: 'k1' }, readable: true };
  const second = { episodeId: 'b', index: 1, file: { assetKey: 'k2' }, readable: false };
  assert.equal(discoverySignature([first, second]), discoverySignature([second, first]));
  assert.notEqual(discoverySignature([first, second]), discoverySignature([{ ...first, readable: false }, second]));
  assert.notEqual(discoverySignature([first, second]), discoverySignature([{ ...first, file: { assetKey: 'moved' } }, second]));
  assert.equal(discoverySignature([]), '');
});
