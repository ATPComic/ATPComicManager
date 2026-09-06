import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadSharedImport } from '../src/shared-import-store.js';
import { storageFor } from '../src/storage/database.js';
import { startServer } from '../src/server.js';
import { resolveWorkspaceConfig } from '../src/utils/cli.js';

test('collection API rejects URL memberships and permits removing legacy missing entries', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-collection-drop-'));
  const badId = 'http://localhost/api/thumbnail?episodeId=20240102';
  storageFor(path.join(workspace,'library.sqlite')).write('library', { episodes: { '20240102': { files: [], variants: {} } }, warnings: [] });
  storageFor(path.join(workspace,'library.sqlite')).write('theme', { title: 'Old', episodes: [badId] });
  const config = await resolveWorkspaceConfig({ workspace, host: '127.0.0.1', port: 0 });
  const server = await startServer(config);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const save = (title, episodes) => fetch(`${base}/api/themes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, episodes }) });
    assert.equal((await save('New', [badId])).status, 400);
    assert.equal((await save('New', ['20240102'])).status, 200);
    assert.equal((await save('Old', [badId, '20240102'])).status, 200);
    assert.equal((await save('Old', ['20240102'])).status, 200);
    const { themes } = await (await fetch(`${base}/api/themes`)).json();
    assert.deepEqual(themes.find(theme => theme.title === 'Old').episodes, ['20240102']);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});

test('JSON export contains library, tags, and variants instead of an arrangement plan', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-comic-export-'));
  const config = await resolveWorkspaceConfig({ workspace, host: '127.0.0.1', port: 0 });
  const server = await startServer(config);

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/export/json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(Object.keys(payload.export).sort(), ['library', 'tags', 'variants']);
    assert.equal('plan' in payload.export, false);
    assert.deepEqual(payload.export.library.episodes, {});
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('JSON import persists shared arrangements and returns placeholders for missing content', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-comic-import-'));
  const config = await resolveWorkspaceConfig({ workspace, host: '127.0.0.1', port: 0 });
  const server = await startServer(config);
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const shared = {
      library: { episodes: { '20240102': { layout: 'folder', variants: { a: [1], b: [], c: [] }, files: [{ name: '20240102_a1.jpg', assignmentToken: 'a1', sourcePageNumber: 1, assignments: [{ variant: 'a', pageNumber: 1 }] }], warnings: [], errors: [] } }, warnings: [] },
      tags: { version: 3, categories: [], episodeTags: {} },
      variants: { version: 3, episodes: { '20240102': { a: ['a1'], b: [], c: [] } }, peekRelations: {} }
    };
    const response = await fetch(`${base}/api/import/json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(shared) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.missingCount, 2);
    assert.equal(payload.library.episodes['20240102'].files[0].missing, true);
    const image = await fetch(`${base}/api/image?episodeId=20240102&index=0`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /image\/svg/);
    assert.equal((await loadSharedImport(config.databasePath)).library.episodes['20240102'].files[0].name, '20240102_a1.jpg');
    const exported = await (await fetch(`${base}/api/export/json`, {method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
    assert.deepEqual(exported.export.variants.episodes, shared.variants.episodes);
    assert.equal(exported.export.library.episodes['20240102'].files[0].name, '20240102_a1.jpg');
    const reimported = await fetch(`${base}/api/import/json`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(exported.export)});
    assert.equal(reimported.status, 200);
    assert.deepEqual((await reimported.json()).variants.episodes, shared.variants.episodes);
    await assert.rejects(fs.access(path.join(workspace,'shared-import.json')), { code: 'ENOENT' });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
