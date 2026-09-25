import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('discovery renders one continuous shortest-column masonry', async () => {
  const source = await readFile(new URL('../ui/src/components/DiscoveryFeed.vue', import.meta.url), 'utf8');
  assert.match(source, /masonryColumns\(/);
  assert.match(source, /class="discovery-column"/);
  assert.match(source, /column-gap: var\(--discovery-gap\)/);
  assert.match(source, /watch\(candidateSignature, refresh/);
  assert.doesNotMatch(source, /watch\(candidates,/);
  assert.doesNotMatch(source, /batches/);
  assert.doesNotMatch(source, /columns: 5 220px/);
});
