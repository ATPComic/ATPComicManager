import test from 'node:test';
import assert from 'node:assert/strict';
import { getPreviewUrl, readInitialViewState } from '../public/view-state.js';

test('preview deep link does not become a search filter', () => {
  assert.deepEqual(readInitialViewState('?episode=20240105'), {
    selectedEpisodeId: '20240105',
    focusedEpisodeId: null,
    searchText: ''
  });
});

test('library focus stays separate from reader preview state', () => {
  assert.deepEqual(readInitialViewState('?focus=folder%3AArchive%2FBonus'), {
    selectedEpisodeId: null,
    focusedEpisodeId: 'folder:Archive/Bonus',
    searchText: ''
  });
});

test('preview URL can be cleared without changing other query parameters', () => {
  const previewUrl = getPreviewUrl('http://localhost/?mode=compact', '20240105');
  assert.equal(previewUrl, 'http://localhost/?mode=compact&episode=20240105');

  const clearedUrl = getPreviewUrl(previewUrl, null);
  assert.equal(clearedUrl, 'http://localhost/?mode=compact');
});
