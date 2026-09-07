import assert from 'node:assert/strict';
import test from 'node:test';
import { portableLibrary, assertPortableJson } from '../src/shared-export.js';
import { mergeSharedLibrary } from '../src/model/library.js';
import { normalizeSharedThemes } from '../src/themes/store.js';

test('portable library uses explicit fields and drops absolute references on every OS', () => {
  for (const reference of ['C:\\Private\\a.png', 'D:/Private/a.png', '\\\\host\\share\\a.png', '/home/private/a.png', 'file:///home/private/a.png']) {
    const result = portableLibrary({ sourceRoot: reference, warnings: [{ message: reference }], episodes: {
      '20260101': { source: reference, sourceKey: reference, errors: [reference], unknown: reference,
        files: [{ name: 'a.png', absolutePath: reference, relativePath: reference, source: reference, unknown: reference }] }
    } });
    assert.ok(!JSON.stringify(result).includes('Private'));
    assert.equal(result.episodes['20260101'].sourceKey, undefined);
    assert.equal(result.episodes['20260101'].files[0].relativePath, undefined);
    assert.doesNotThrow(() => assertPortableJson(result));
    assert.throws(() => assertPortableJson({ recognition: { episodeDates: { [`folder:${reference}`]: '2026-01-01' } } }), /absolute path/);
    assert.throws(() => assertPortableJson({ themes: [{ episodes: [`folder:${reference}`] }] }), /absolute path/);
  }
});

test('shared theme validation rejects malformed input before storage', () => {
  for (const themes of [{}, [{ title: '../outside', episodes: [] }], [{ title: 'Set', episodes: ['https://example.test/image'] }]]) {
    assert.throws(() => normalizeSharedThemes(themes));
  }
});

function libraryWith(id, name, relativePath) {
  return { episodes: { [id]: { title: 'Set-One', files: [{ name, relativePath, assignmentToken: 'a1' }], variants: {} } }, warnings: [] };
}

test('dated episodes match identical filenames even when relative locations differ', () => {
  const local = libraryWith('20260101', '20260101_a1.png', 'Moved/20260101_a1.png');
  const shared = libraryWith('20260101', '20260101_a1.png', 'Original/20260101_a1.png');
  mergeSharedLibrary(local, shared);
  assert.equal(local.warnings.length, 0);
  assert.equal(local.episodes['20260101'].files.length, 1);
  assert.equal(local.episodes['20260101'].files[0].relativePath, 'Moved/20260101_a1.png');
});

test('dated files remain matched after their middle title changes', () => {
  const local = libraryWith('20260101', '20260101_new_a1.png', 'new');
  mergeSharedLibrary(local, libraryWith('20260101', '20260101_old_a1.png', 'old'));
  assert.equal(local.warnings.length, 0);
  assert.equal(local.episodes['20260101'].files.length, 1);
});

test('undated episode identities change when their workspace-relative folders move', () => {
  const local = libraryWith('folder:New/Set-One', '001.png', 'Set-One/001.png');
  mergeSharedLibrary(local, libraryWith('folder:Archive/Set-One', '001.png', 'Set-One/001.png'));
  assert.equal(local.episodes['folder:Archive/Set-One'].missing, true);
  assert.equal(Object.keys(local.episodes).length, 2);
});
