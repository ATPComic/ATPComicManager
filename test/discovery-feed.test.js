import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('discovery appends each prepared batch as its own stable masonry group', async () => {
  const source = await readFile(new URL('../ui/src/components/DiscoveryFeed.vue', import.meta.url), 'utf8');
  assert.match(source, /batches\.value = \[\.\.\.batches\.value, batch\]/);
  assert.doesNotMatch(source, /index \+= 60/);
  assert.match(source, /v-for="\(batch, batchIndex\) in batches"/);
});
