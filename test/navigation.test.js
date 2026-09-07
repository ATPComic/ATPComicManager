import assert from 'node:assert/strict';
import test from 'node:test';
import { currentAppPath, libraryEpisodePath, returnPathFromHref, variantEpisodePath } from '../ui/src/navigation.js';

test('variant links return to the originating gallery episode including encoded folder IDs', () => {
  for (const id of ['20260101', 'folder:Archive/Set One']) {
    const href = variantEpisodePath(id);
    assert.equal(new URL(href, 'http://app.local').searchParams.get('episode'), id);
    assert.equal(returnPathFromHref(href), libraryEpisodePath(id));
  }
});

test('current application path preserves query parameters and fragments', () => {
  assert.equal(currentAppPath({ pathname: '/warnings.html', search: '?type=file', hash: '#row' }), '/warnings.html?type=file#row');
});

test('library episode paths address the matching gallery row', () => {
  assert.equal(libraryEpisodePath('folder:Archive/Bonus 1'), '/?focus=folder%3AArchive%2FBonus%201');
  assert.equal(libraryEpisodePath(null), '/');
});

test('return paths remain inside the current application origin', () => {
  assert.equal(returnPathFromHref('http://app.local/variants.html?returnTo=%2Fwarnings.html%3Ftype%3Dfile'), '/warnings.html?type=file');
  assert.equal(returnPathFromHref('http://app.local/variants.html?returnTo=%2F%2Fevil.example', '/'), '/');
  assert.equal(returnPathFromHref('http://app.local/variants.html?returnTo=https%3A%2F%2Fevil.example', '/'), '/');
});
