import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanWorkspace } from '../src/scanner/scanner.js';
import { resolveWorkspaceConfig } from '../src/utils/cli.js';

async function createFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'x');
}

test('workspace config preserves automatic archive discovery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-config-'));
  await createFile(path.join(root, 'Comics', 'SetA', '20240105', '20240105_a1.jpg'));

  const config = await resolveWorkspaceConfig({ workspace: root });
  assert.equal(config.archiveRoot, null);
  assert.equal(config.host, '127.0.0.1');

  const library = await scanWorkspace(config.workspaceRoot, config.archiveRoot);
  assert.ok(library.episodes['20240105']);
  assert.deepEqual(library.meta.archiveRoots, ['Comics/SetA']);
});

test('workspace config prefers the conventional Archive directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-config-'));
  const archive = path.join(root, 'Archive');
  await fs.mkdir(archive, { recursive: true });

  const config = await resolveWorkspaceConfig({ workspace: root, host: 'localhost', port: '4321' });
  assert.equal(config.archiveRoot, archive);
  assert.equal(config.host, 'localhost');
  assert.equal(config.port, 4321);
});
