import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDatedSources, datedFileIdentity } from '../src/validation/filename.js';
import { applyVariantAssignments } from '../src/model/variant-assignments.js';
import { mergeSharedLibrary } from '../src/model/library.js';
import { scanWorkspace } from '../src/scanner/scanner.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { alignVariantTokens } from '../src/variant-store.js';
import { storageFor } from '../src/storage/database.js';
import { startServer } from '../src/server.js';
import { resolveWorkspaceConfig } from '../src/utils/cli.js';

test('rescan repairs stored alias tokens from actual filenames and retains manual page mappings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-token-repair-'));
  let server;
  try {
    const dir = path.join(root, 'Archive', '20260101');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, '20260101_1.png'), 'fixture');
    const config = await resolveWorkspaceConfig({ workspace: root, host: '127.0.0.1', port: 0 });
    const store = storageFor(config.databasePath);
    store.write('library', { episodes: { '20260101': { files: [{ name: '20260101_1.png', assignmentToken: '1_x' }], variants: {} } }, warnings: [] });
    store.write('variants', { version: 3, episodes: { '20260101': { b: ['1_x'] } }, pageMappings: { '20260101': { b: { '1_x': 7 } } } });
    server = await startServer(config);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/scan`, { method: 'POST' });
    assert.equal(response.status, 200);
    const file = (await response.json()).library.episodes['20260101'].files[0];
    assert.equal(file.assignmentToken, '1');
    assert.deepEqual(file.assignments, [{ variant: 'b', pageNumber: 7 }]);
    assert.deepEqual(store.read('variants').episodes['20260101'].b, ['1']);
    assert.deepEqual(store.read('variants').pageMappings['20260101'].b, { '1': 7 });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('token repair never steals assignments from another real filename', () => {
  const state = { version: 3, episodes: { '20260101': { b: ['1_x'] } } };
  const value = library(['20260101_1.png', '20260101_1_x.png']);
  value.episodes['20260101'].files[0].assignmentToken = '1_x';
  assert.deepEqual(alignVariantTokens(state, value).episodes['20260101'].b, ['1_x']);
});

const ranked = ['20260101_01_x.png', '20260101_01.png', '20260101_title_01_x.png', '20260101_title_01.png'];
const library = names => ({ episodes: { '20260101': { files: names.map(name => ({ name })), variants: {} } }, warnings: [] });

test('monthly sources outrank daily sources before filename priority without dropping unique pages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-layout-priority-'));
  try {
    for (const [folder, name] of [
      ['20260101', '20260101_01_x.png'],
      ['20260101', '20260101_02.png'],
      ['202601', '20260101_title_01.png'],
      ['202601', '20260101_title_01_x.png']
    ]) {
      await fs.mkdir(path.join(root, 'Archive', folder), { recursive: true });
      await fs.writeFile(path.join(root, 'Archive', folder, name), 'fixture');
    }
    const result = await scanWorkspace(root, path.join(root, 'Archive'), { version: 3, episodes: { '20260101': { a: ['01', '02'] } } });
    const episode = result.episodes['20260101'];
    assert.equal(episode.layout, 'month-flat');
    assert.equal(episode.source, path.join(root, 'Archive', '202601'));
    assert.deepEqual(new Set(episode.files.map(file => file.name)), new Set(['20260101_title_01_x.png', '20260101_title_01.png', '20260101_02.png']));
    assert.deepEqual(episode.files.find(file => file.name === '20260101_title_01.png').assignments, [{ variant: 'a', pageNumber: 1 }]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('dated duplicate priority prefers no title but never merges x and plain tokens', () => {
  for (let start = 0; start < ranked.length; start++) {
    for (const names of [ranked.slice(start), ranked.slice(start).reverse()]) {
      const value = library(names);
      selectDatedSources(value);
      const expected = [...new Set(names.map(name => name.includes('_01_x.') ? names.find(item => item === ranked[0]) ?? ranked[2] : names.find(item => item === ranked[1]) ?? ranked[3]))];
      assert.deepEqual(new Set(value.episodes['20260101'].files.map(file => file.name)), new Set(expected));
    }
  }
});

test('title replacements keep exact filename tokens and page mappings', () => {
  for (const name of ranked) {
    for (const token of ['01', '01_x']) {
      const actualToken = name.includes('_01_x.') ? '01_x' : '01';
      const value = library([name]);
      applyVariantAssignments(value, { version: 3, episodes: { '20260101': { b: [token] } }, pageMappings: { '20260101': { b: { [token]: 7 } } } });
      assert.deepEqual(value.episodes['20260101'].files[0].assignments, token === actualToken ? [{ variant: 'b', pageNumber: 7 }] : []);
      assert.equal(value.episodes['20260101'].files[0].assignmentToken, actualToken);
      mergeSharedLibrary(value, library([`20260101_other_${actualToken}.png`]));
      assert.equal(value.warnings.length, 0);
      assert.equal(value.episodes['20260101'].files.length, 1);
    }
  }
});

test('different dates, pages, variant letters and configured markers remain distinct', () => {
  assert.notEqual(datedFileIdentity({ name: '20260101_a1.png' }), datedFileIdentity({ name: '20260101_b1.png' }));
  assert.notEqual(datedFileIdentity({ name: '20260101_01.png' }), datedFileIdentity({ name: '20260102_01.png' }));
  const value = library(['20260101_01.png', '20260101_02.png', '20260101_clean_01.png']);
  selectDatedSources(value, ['clean']);
  assert.equal(value.episodes['20260101'].files.length, 3);
});

test('undated folders do not inherit dated duplicate rules', () => {
  const value = { episodes: { 'folder:Archive/Set': { files: ranked.map(name => ({name})) } }, warnings: [] };
  selectDatedSources(value);
  assert.equal(value.episodes['folder:Archive/Set'].files.length, 4);
});
