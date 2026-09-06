import test from 'node:test';
import assert from 'node:assert/strict';
import { EPISODE_DRAG_TYPE, draggedEpisodeId } from '../public/collection-model.js';

test('episode drops ignore native image URLs and validate custom identities', () => {
  const episodes = { '20240102': {} };
  const transfer = values => ({ getData: type => values[type] ?? '' });
  const image = transfer({ 'text/plain': 'http://localhost/api/thumbnail?episodeId=20240102' });
  assert.equal(draggedEpisodeId(image, null, episodes), null);
  assert.equal(draggedEpisodeId(image, '20240102', episodes), '20240102');
  assert.equal(draggedEpisodeId(transfer({ [EPISODE_DRAG_TYPE]: '20240102' }), null, episodes), '20240102');
  assert.equal(draggedEpisodeId(transfer({ [EPISODE_DRAG_TYPE]: 'unknown' }), null, episodes), null);
  assert.equal(draggedEpisodeId(transfer({ [EPISODE_DRAG_TYPE]: '__proto__' }), null, episodes), null);
});
