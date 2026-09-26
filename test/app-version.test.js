import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAppVersion } from '../ui/src/lib/app-version.js';

test('app version prefers the desktop runtime value and falls back elsewhere', async () => {
  assert.equal(await resolveAppVersion('1.2.3', { getAppVersion: async () => '9.9.9' }), '9.9.9');
  assert.equal(await resolveAppVersion('1.2.3', { getAppVersion: async () => '' }), '1.2.3');
  assert.equal(await resolveAppVersion('1.2.3', {}), '1.2.3');
  assert.equal(await resolveAppVersion('1.2.3', undefined), '1.2.3');
  assert.equal(await resolveAppVersion('1.2.3'), '1.2.3');
  assert.equal(await resolveAppVersion('1.2.3', { getAppVersion: async () => { throw new Error('bridge down'); } }), '1.2.3');
});