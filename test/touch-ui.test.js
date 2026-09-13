import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scrollHeaderState } from '../public/scroll-header.js';

test('touch header hides while scrolling down and returns on upward motion or at the top', () => {
  let state = { top: 0, hidden: false, travel: 0 };
  state = scrollHeaderState(state, 40);
  assert.equal(state.hidden, true);
  state = scrollHeaderState(state, 37);
  assert.equal(state.hidden, true);
  state = scrollHeaderState(state, 15);
  assert.equal(state.hidden, false);
  assert.equal(scrollHeaderState({ top: 100, hidden: true, travel: 50 }, 0).hidden, false);
  assert.equal(scrollHeaderState({ top: 500, hidden: true, travel: 100 }, 444, 444).hidden, true);
});

test('touch selection and child expansion use separate buttons and avoid native drag', async () => {
  const tree = await readFile(new URL('../ui/src/components/TouchTagTree.vue', import.meta.url), 'utf8');
  assert.match(tree, /class="touch-tag-expand"/);
  assert.match(tree, /class="touch-tag-select"/);
  assert.match(tree, /@click\.stop="toggle\(node.id\)"/);
  assert.match(tree, /@click\.stop="emit\('select', node.id\)"/);
  const app = await readFile(new URL('../ui/src/App.vue', import.meta.url), 'utf8');
  assert.match(app, /:draggable="!touchUi && !touchGesture"/);
  const filter = await readFile(new URL('../ui/src/components/TagFilterControl.vue', import.meta.url), 'utf8');
  assert.match(filter, /var-popup v-if="touch"/);
  assert.match(filter, /position="bottom"/);
});
