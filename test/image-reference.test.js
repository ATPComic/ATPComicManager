import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { startServer } from '../src/server.js';
import { resolveWorkspaceConfig } from '../src/utils/cli.js';
import { getImageUrl, getThumbnailUrl } from '../public/reader-model.js';

test('image and thumbnail URLs follow selected monthly files, not stale positional indexes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-image-reference-'));
  let server;
  try {
    const config = await resolveWorkspaceConfig({ workspace: root, host: '127.0.0.1', port: 0 });
    const write = async (folder, name, color) => {
      const directory = path.join(root, 'Archive', folder);
      await fs.mkdir(directory, { recursive: true });
      const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).png().toBuffer();
      await fs.writeFile(path.join(directory, name), bytes);
      return bytes;
    };
    await write('20260101', '20260101_a2.png', '#ff0000');
    server = await startServer(config);
    const request = (route, options) => fetch(`http://127.0.0.1:${server.address().port}${route}`, options);
    const scan = async () => {
      const response = await request('/api/scan', { method: 'POST' });
      assert.equal(response.status, 200);
      return (await response.json()).library.episodes['20260101'];
    };
    const original = await scan();
    const oldUrl = getImageUrl('20260101', 0, original.files[0].assetKey);
    const monthlyBytes = await write('202601', '20260101_title_a2.png', '#0000ff');
    await write('202601', '20260101_a1.png', '#00ff00');
    const current = await scan();
    assert.equal(current.layout, 'month-flat');
    assert.equal(current.files[1].name, '20260101_title_a2.png');
    assert.notEqual(current.files[1].assetKey, original.files[0].assetKey);
    assert.equal((await request(oldUrl)).status, 404);
    const stableUrl = getImageUrl('20260101', 0, current.files[1].assetKey);
    assert.deepEqual(Buffer.from(await (await request(stableUrl)).arrayBuffer()), monthlyBytes);
    const thumbnailUrl = getThumbnailUrl('20260101', 0, current.files[1].assetKey);
    const thumbnail = await request(thumbnailUrl);
    assert.equal(thumbnail.status, 200);
    const stats = await sharp(Buffer.from(await thumbnail.arrayBuffer())).stats();
    assert.ok(stats.channels[2].mean > 200 && stats.channels[0].mean < 20);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    server = await startServer(config);
    assert.deepEqual(Buffer.from(await (await request(stableUrl)).arrayBuffer()), monthlyBytes);
    const exported = await (await request('/api/export/json', { method: 'POST' })).json();
    assert.ok(!JSON.stringify(exported.export).includes('assetKey'));
    assert.ok(!stableUrl.includes(root));
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await fs.rm(root, { recursive: true, force: true });
  }
});
