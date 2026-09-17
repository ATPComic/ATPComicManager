import test from 'node:test';
import assert from 'node:assert/strict';
import { scanDirectoryRecords } from '../ui/src/pages/scan-model.js';
import { collectDirectoryFiles, indexImportedFiles, matchImportedFile } from '../ui/src/pages/import-model.js';

const initial = () => ({ library: { episodes: {} }, recognition: { rules: [], identityMarkers: [], episodeDates: {} }, variantAssignments: { version: 3, episodes: {} } });
const file = path => ({ name: path.split('/').at(-1), webkitRelativePath: `Root/${path}` });

test('Pages scans without JSON and shares monthly source priority and filename variants', () => {
  const library = scanDirectoryRecords([
    file('20260101_x/20260101_title_a1.png'), file('202601/20260101_a1.png'),
    file('202601/20260101_b1_extra.png')
  ], initial(), 'stable');
  const episode = library.episodes['20260101'];
  assert.equal(episode.layout, 'month-flat');
  assert.equal(episode.files.length, 2);
  assert.deepEqual(episode.variants.a, [1]);
  assert.deepEqual(episode.variants.b, [1]);
  assert.ok(episode.files.every(item => item.assetKey.startsWith('stable:202601/')));
});

test('Pages custom folders retain assigned dates and manual arrangements across discovery', () => {
  const state = initial();
  state.recognition.rules = [{ prefix: 'set-' }];
  state.recognition.episodeDates['folder:set-one'] = '20260102';
  state.variantAssignments.episodes['folder:set-one'] = { a: ['01'], b: ['02'] };
  state.library = scanDirectoryRecords([file('set-one/01.png'), file('set-one/02.png')], state, 'stable');
  const next = scanDirectoryRecords([file('set-one/01.png'), file('set-one/02.png'), file('set-one/03.png')], state, 'stable');
  assert.equal(next.episodes['folder:set-one'].date, '20260102');
  assert.deepEqual(next.episodes['folder:set-one'].variants.a, [1]);
  assert.equal(next.episodes['folder:set-one'].files.length, 3);
});

test('Pages rescans retain missing placeholders but prefer relocated real equivalents', () => {
  const state = initial();
  state.library = scanDirectoryRecords([file('202601/20260101_a1.png'), file('202601/20260102_a1.png')], state, 'stable');
  const next = scanDirectoryRecords([file('20260101/20260101_changed_a1.png')], state, 'stable');
  assert.equal(next.episodes['20260101'].files.length, 1);
  assert.equal(next.episodes['20260101'].files[0].missing, undefined);
  assert.equal(next.episodes['20260102'].files[0].missing, true);
});

test('directory indexing never reads originals and skips generated and unrelated content', async () => {
  const image = name => ({ name, kind: 'file', getFile() { assert.fail('indexing read original'); } });
  const directory = (name, entries) => ({ name, kind: 'directory', async *values() { yield* entries; } });
  const root = directory('Root', [directory('202601', [image('20260101_a1.png'), image('notes.txt')]), directory('Reading', [image('duplicate.png')]), directory('.hidden', [image('hidden.jpg')])]);
  const files = await collectDirectoryFiles(root);
  assert.deepEqual(files.map(item => item.webkitRelativePath), ['Root/202601/20260101_a1.png']);
});

test('imported custom folder identities survive a different selected root and new files', () => {
  const state = initial();
  state.recognition.rules = [{ prefix: 'set-' }];
  state.library.episodes['folder:set-one'] = { layout: 'rule-folder', files: [{ name: '01.png', relativePath: 'set-one/01.png', assetKey: 'stable:Archive/set-one/01.png' }] };
  const next = scanDirectoryRecords([file('Archive/set-one/01.png'), file('Archive/set-one/02.png')], state, 'stable');
  assert.deepEqual(Object.keys(next.episodes), ['folder:set-one']);
  assert.equal(next.episodes['folder:set-one'].files.length, 2);
});

test('Pages import matches renamed dated titles with monthly priority', () => {
  const monthly = file('202601/20260101_changed_a1.png');
  const index = indexImportedFiles([file('20260101/20260101_a1.png'), monthly]);
  assert.equal(matchImportedFile({ name: '20260101_old_a1.png', relativePath: 'elsewhere/20260101_old_a1.png' }, index), monthly);
});
