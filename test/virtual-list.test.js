import test from 'node:test';
import assert from 'node:assert/strict';
import { getVirtualWindow } from '../public/virtual-list.js';

test('large arrangements render only a buffered visible window', () => {
  const window = getVirtualWindow(3000, 65 * 1500, 650, 65, 6);
  assert.equal(window.end - window.start, 22);
  assert.ok(window.start > 1400);
  assert.equal(window.topHeight + (window.end - window.start) * 65 + window.bottomHeight, 3000 * 65);
});
