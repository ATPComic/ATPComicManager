import assert from 'node:assert/strict';
import test from 'node:test';
import { compareEpisodesByDate, countTagEpisodes, getEpisodeDate, matchesDateFilter, matchesTagFilter, moveItemToSlot } from '../public/collection-model.js';

test('episode tag filter matches a category and value pair', () => {
  const tags = { people: ['Alice', 'Bob'], style: ['Ink'] };
  assert.equal(matchesTagFilter(tags, ''), true);
  assert.equal(matchesTagFilter(tags, `people\u001fAlice`), true);
  assert.equal(matchesTagFilter(tags, `people\u001fCarol`), false);
  assert.equal(matchesTagFilter(tags, `style\u001fInk`), true);
  assert.equal(matchesTagFilter(tags, 'invalid-filter'), false);
});

test('multi-tag filters use OR within a category and AND across categories', () => {
  const categories = [
    { id: 'people', values: [{ id: 'characters', values: [{ id: 'alice' }, { id: 'bob' }] }] },
    { id: 'style', values: [{ id: 'ink' }, { id: 'paint' }] }
  ];
  const tags = { people: ['alice'], style: ['ink'] };
  assert.equal(matchesTagFilter(tags, {}, categories), true);
  assert.equal(matchesTagFilter(tags, { people: ['characters'] }, categories), true);
  assert.equal(matchesTagFilter(tags, { people: ['bob', 'alice'], style: ['ink'] }, categories), true);
  assert.equal(matchesTagFilter(tags, { people: ['alice'], style: ['paint'] }, categories), false);
});

test('tag episode counts follow hierarchy and the current episode scope', () => {
  const categories = [{
    id: 'style',
    values: [{ id: 'traditional', values: [{ id: 'ink' }, { id: 'paint' }] }, { id: 'photo' }]
  }];
  const counts = countTagEpisodes(
    ['ep-1', 'ep-2', 'ep-3'],
    {
      'ep-1': { style: ['ink', 'paint'] },
      'ep-2': { style: ['traditional'] },
      'ep-3': { style: ['photo'] },
      'outside-scope': { style: ['ink'] }
    },
    categories
  );
  assert.deepEqual(counts, {
    style: { traditional: 2, ink: 1, paint: 1, photo: 1 }
  });
});

test('episode ordering accepts insertion slots before the first and after the last item', () => {
  assert.deepEqual(moveItemToSlot(['A', 'B', 'C'], 'A', 3), ['B', 'C', 'A']);
  assert.deepEqual(moveItemToSlot(['A', 'B', 'C'], 'C', 0), ['C', 'A', 'B']);
  assert.deepEqual(moveItemToSlot(['A', 'B', 'C'], 'B', 2), ['A', 'B', 'C']);
});

test('date filters support year, month, and day ranges including assigned folder dates', () => {
  assert.equal(getEpisodeDate('20240517', {}), '2024-05-17');
  assert.equal(getEpisodeDate('folder:Archive/Special', { date: '2023-11-02' }), '2023-11-02');
  assert.equal(matchesDateFilter('20240517', {}, { granularity: 'year', start: '2024', end: '2024' }), true);
  assert.equal(matchesDateFilter('20240517', {}, { granularity: 'month', start: '2024-06', end: '' }), false);
  assert.equal(matchesDateFilter('folder:x', {}, { granularity: 'day', start: '2020-01-01', end: '' }), false);
  const sorted = [['folder:x', {}], ['20240517', {}], ['folder:y', { date: '2023-01-01' }]].sort(compareEpisodesByDate);
  assert.deepEqual(sorted.map(([id]) => id), ['folder:y', '20240517', 'folder:x']);
});
