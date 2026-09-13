import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { schema, loadCatalog, saveCatalog } from '../ui/src/pages/catalog.js';
import { collectDirectoryFiles, indexImportedFiles, matchImportedFile, readSharedCatalog } from '../ui/src/pages/import-model.js';

function adapter(native) {
  return { exec(input) {
    if (typeof input === 'string') return native.exec(input);
    const statement = native.prepare(input.sql);
    return input.returnValue ? statement.all(...(input.bind ?? [])) : statement.run(...(input.bind ?? []));
  } };
}
test('Pages SQLite catalog preserves relationships, explicit empty variants and ordering', () => {
  const native = new DatabaseSync(':memory:');
  const db = adapter(native);
  try {
    db.exec(schema);
    const state = loadCatalog(db);
    state.library.episodes['20260101'] = { title: 'Set', files: [{ name: '20260101_a1.png', assetKey: 'local' }] };
    state.tags.categories = [{ id: 'subject', values: [{ id: 'cat', name: 'Cat' }] }];
    state.tags.episodeTags = { '20260101': { subject: ['cat'] } };
    state.themes = [{ title: 'Collection', episodes: ['20260101'], tags: {} }];
    state.variantAssignments.episodes['20260101'] = { a: [] };
    saveCatalog(db, state);
    assert.deepEqual(loadCatalog(db), state);
    native.exec("CREATE TRIGGER prevent_file_rewrite BEFORE UPDATE ON files BEGIN SELECT RAISE(ABORT, 'unchanged file rewritten'); END");
    state.tags.categories[0].values[0].name = 'Updated';
    saveCatalog(db, state);
    assert.deepEqual(loadCatalog(db), state);
    assert.throws(() => db.exec("INSERT INTO files VALUES('unknown',0,'{}')"), /FOREIGN KEY/);
    assert.throws(() => saveCatalog(db, { ...state, themes: [state.themes[0], state.themes[0]] }), /UNIQUE/);
    assert.deepEqual(loadCatalog(db), state);
  } finally { native.close(); }
});
test('Pages import uses unique relative paths and never guesses between duplicate names', () => {
  const a = { name: 'a1.png', webkitRelativePath: 'Library/day/a1.png' };
  const b = { name: 'a1.png', webkitRelativePath: 'Library/other/a1.png' };
  assert.equal(matchImportedFile({ name: 'a1.png', relativePath: 'day/a1.png' }, [a, b]), a);
  assert.equal(matchImportedFile({ name: 'a1.png' }, [a, b]), null);
  assert.equal(matchImportedFile({ name: 'a1.png' }, [a]), a);
  assert.throws(() => readSharedCatalog({}), /pagesInvalidImport/);
  assert.throws(() => readSharedCatalog({ library: { episodes: {} }, tags: { categories: [] }, variants: {}, themes: [{ title: 'C:\\private' }] }), /absolute path/);
});

test('Pages directory indexing retains handles without reading image contents', async () => {
  const image = { kind: 'file', name: 'a1.png', getFile() { throw new Error('Must not read originals during indexing'); } };
  const folder = (name, children) => ({ kind: 'directory', name, async *values() { yield* children; } });
  const files = await collectDirectoryFiles(folder('Library', [folder('day', [image])]));
  assert.equal(files[0].handle, image);
  assert.equal(files[0].webkitRelativePath, 'Library/day/a1.png');
  assert.equal(matchImportedFile({ relativePath: 'day/a1.png' }, indexImportedFiles(files)).handle, image);
});

test('Pages matches large catalogs through one reusable index', () => {
  const files = Array.from({ length: 30000 }, (_, i) => ({ name: `${i}.png`, webkitRelativePath: `Library/day/${i}.png` }));
  const index = indexImportedFiles(files);
  for (let i = 0; i < files.length; i++) assert.equal(matchImportedFile({ relativePath: `day/${i}.png` }, index), files[i]);
  const ambiguous = indexImportedFiles([{ name: 'x.png', webkitRelativePath: 'one/day/x.png' }, { name: 'x.png', webkitRelativePath: 'two/day/x.png' }]);
  assert.equal(matchImportedFile({ relativePath: 'day/x.png' }, ambiguous), null);
});
