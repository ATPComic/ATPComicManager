import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadSharedImport } from '../src/shared-import-store.js';
import { storageFor } from '../src/storage/database.js';
import { startServer } from '../src/server.js';
import { resolveWorkspaceConfig } from '../src/utils/cli.js';
import { loadRecognitionState, saveRecognitionState } from '../src/recognition-store.js';

test('shared JSON carries custom recognition, dates and manual variants across workspaces and restarts', async () => {
  const episodeId = 'folder:Archive/Set-One';
  const roots = await Promise.all(['source', 'target'].map(name => fs.mkdtemp(path.join(os.tmpdir(), `atp-share-${name}-`))));
  const servers = [];
  try {
    const configs = [];
    for (const root of roots) {
      await fs.mkdir(path.join(root, 'Archive', 'Set-One'), { recursive: true });
      await fs.writeFile(path.join(root, 'Archive', 'Set-One', 'clean_001.png'), 'fixture');
      configs.push(await resolveWorkspaceConfig({ workspace: root, host: '127.0.0.1', port: 0 }));
    }
    const recognition = { rules: [{ id: 'sets', prefix: 'Set-', suffix: '' }], identityMarkers: ['clean'], episodeDates: { [episodeId]: '2026-01-02' } };
    await saveRecognitionState(configs[0].databasePath, recognition);
    storageFor(configs[0].databasePath).write('variants', { version: 3, episodes: { [episodeId]: { a: [], b: ['001_clean'], c: [] } }, peekRelations: {} });
    await saveRecognitionState(configs[1].databasePath, { rules: [{ id: 'sets', prefix: 'Local-', suffix: '' }], identityMarkers: ['local'], episodeDates: { 'folder:Archive/Local-One': '2025-01-01' } });
    for (const config of configs) servers.push(await startServer(config));
    const request = async (server, route, body = {}) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value));
      return value;
    };
    const exported = await request(servers[0], '/api/export/json');
    assert.deepEqual(exported.export.recognition, { version: 1, ...recognition });
    const imported = await request(servers[1], '/api/import/json', exported);
    assert.equal(imported.missingCount, 0);
    const episode = imported.library.episodes[episodeId];
    assert.ok(episode);
    assert.equal(episode.date, '2026-01-02');
    assert.ok(!episode.files[0].missing);
    assert.equal(episode.files[0].assignmentToken, '001_clean');
    assert.deepEqual(episode.files[0].assignments, [{ variant: 'b', pageNumber: 1 }]);
    const saved = await loadRecognitionState(configs[1].databasePath);
    assert.deepEqual(saved.identityMarkers, ['local', 'clean']);
    assert.equal(saved.rules.length, 2);
    assert.equal(new Set(saved.rules.map(rule => rule.id)).size, 2);
    assert.equal(saved.episodeDates[episodeId], '2026-01-02');
    assert.equal(saved.episodeDates['folder:Archive/Local-One'], '2025-01-01');
    await request(servers[1], '/api/import/json', exported);
    assert.deepEqual(await loadRecognitionState(configs[1].databasePath), saved);
    servers[1].closeAllConnections();
    await new Promise(resolve => servers[1].close(resolve));
    servers[1] = await startServer(configs[1]);
    await request(servers[1], '/api/scan');
    const afterRestart = await request(servers[1], '/api/export/json');
    assert.deepEqual(afterRestart.export.recognition, saved);
    assert.equal(afterRestart.export.library.episodes[episodeId].date, '2026-01-02');
    assert.deepEqual(afterRestart.export.library.episodes[episodeId].files[0].assignments, [{ variant: 'b', pageNumber: 1 }]);
    const rejected = await fetch(`http://127.0.0.1:${servers[1].address().port}/api/import/json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...exported.export, recognition: { identityMarkers: ['.*'] } }) });
    assert.equal(rejected.status, 500);
    assert.deepEqual(await loadRecognitionState(configs[1].databasePath), saved);
  } finally {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    for (const root of roots) await fs.rm(root, { recursive: true, force: true });
  }
});

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

test('JSON export omits diagnostics and local source paths without changing stored diagnostics', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-export-privacy-'));
  const config = await resolveWorkspaceConfig({ workspace, host: '127.0.0.1', port: 0 });
  const diagnostic = { type: 'fixture', message: 'Cannot read C:\\PrivateUser\\library\\image.png or /home/private/library/image.png', path: 'C:\\PrivateUser\\library', relatedPaths: ['/home/private/library'], details: { source: 'C:\\PrivateUser\\library' } };
  const store = storageFor(config.databasePath);
  store.write('library', {
    episodes: { '20260101': { source: 'C:\\PrivateUser\\library', layout: 'folder', warnings: [diagnostic], errors: [diagnostic], variants: { a: [1] }, files: [{ name: '20260101_a1.png', relativePath: 'Archive/20260101/20260101_a1.png', absolutePath: 'C:\\PrivateUser\\library\\20260101_a1.png', source: 'C:\\PrivateUser\\library', assignmentToken: 'a1', assignments: [{ variant: 'a', pageNumber: 1 }] }] } },
    warnings: [diagnostic]
  });
  const server = await startServer(config);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/export/json`, { method: 'POST' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const serialized = JSON.stringify(payload.export);
    for (const privateText of ['PrivateUser', '/home/private', 'Cannot read']) assert.ok(!serialized.includes(privateText));
    const check = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        assert.ok(!['warnings', 'errors', 'absolutePath', 'source'].includes(key), key);
        check(child);
      }
    };
    check(payload.export.library);
    const episode = payload.export.library.episodes['20260101'];
    assert.equal(episode.files[0].relativePath, 'Archive/20260101/20260101_a1.png');
    assert.deepEqual(episode.files[0].assignments, [{ variant: 'a', pageNumber: 1 }]);
    const stored = store.read('library');
    assert.deepEqual(stored.warnings, [diagnostic]);
    assert.deepEqual(stored.episodes['20260101'].warnings, [diagnostic]);
    assert.deepEqual(stored.episodes['20260101'].errors, [diagnostic]);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(workspace, { recursive: true, force: true });
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
    assert.deepEqual(Object.keys(payload.export).sort(), ['library', 'recognition', 'tags', 'variants']);
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
