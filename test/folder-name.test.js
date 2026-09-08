import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchArchiveFolderName } from '../src/utils/path.js';
import { scanWorkspace } from '../src/scanner/scanner.js';

test('folder recognition finds date and month segments with surrounding text', () => {
  for (const name of ['20250101_x', 'Set-20250101-extra', '20250101']) assert.deepEqual(matchArchiveFolderName(name), { layout: 'folder', date: '20250101' });
  for (const name of ['202501_extra', 'Set-202501', '202501']) assert.deepEqual(matchArchiveFolderName(name), { layout: 'month-flat', month: '202501' });
  assert.equal(matchArchiveFolderName('12320250101987'), null);
});

test('partial folder matches work through discovery and preserve monthly priority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-partial-folder-'));
  try {
    for (const folder of ['20250101_x', 'Set-202501-extra']) {
      const directory = path.join(root, 'Nested', folder);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, '20250101_a1.png'), 'fixture');
    }
    const library = await scanWorkspace(root);
    assert.deepEqual(Object.keys(library.episodes), ['20250101']);
    assert.equal(library.episodes['20250101'].layout, 'month-flat');
    assert.equal(library.episodes['20250101'].files.length, 1);
    assert.equal(path.basename(library.episodes['20250101'].files[0].source), 'Set-202501-extra');
    assert.ok(!library.warnings.some(warning => warning.type === 'folder-file-date-mismatch'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
