import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startServer } from '../src/server.js';
import { resolveWorkspaceConfig } from '../src/utils/cli.js';

test('cleaning an episode drops deleted files and their variant indexes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-episode-clean-'));
  let server;
  try {
    const folder = path.join(root, 'Archive', '20260101');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, '20260101_a1.png'), 'fixture');
    await fs.writeFile(path.join(folder, '20260101_a2.png'), 'fixture');
    const config = await resolveWorkspaceConfig({ workspace: root, host: '127.0.0.1', port: 0 });
    server = await startServer(config);
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (route, body = {}) => {
      const response = await fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      assert.equal(response.status, 200);
      return response.json();
    };

    await post('/api/scan');
    const saved = await fetch(`${base}/api/variants`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 4,
        episodes: { '20260101': { a: ['a1', 'a2'], b: [], c: [] } },
        pageMappings: { '20260101': { a: { a2: 2 } } }
      })
    });
    assert.equal(saved.status, 200);

    await fs.rm(path.join(folder, '20260101_a2.png'));
    const cleaned = await post('/api/episodes/20260101/clean');

    assert.equal(cleaned.removed, 1);
    assert.deepEqual(cleaned.library.episodes['20260101'].files.map(file => file.name), ['20260101_a1.png']);
    assert.deepEqual(cleaned.variantAssignments.episodes['20260101'], { a: ['a1'], b: [], c: [] });
    assert.equal(cleaned.variantAssignments.pageMappings, undefined);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
