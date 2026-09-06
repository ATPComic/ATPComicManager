import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadThemes, renameTheme, saveTheme } from '../src/themes/store.js';

test('renames a theme without deleting its episode list', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-themes-'));
  await saveTheme(path.join(root,'library.sqlite'), { title: 'Old', episodes: ['20240101', '20240102'] });

  await renameTheme(path.join(root,'library.sqlite'), 'Old', 'New');
  assert.deepEqual(await loadThemes(path.join(root,'library.sqlite')), [{
    title: 'New', episodes: ['20240101', '20240102'], tags: {}
  }]);
  await assert.rejects(fs.access(path.join(root, 'Old.json')));
});

test('rejects theme titles that escape the themes directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-themes-'));
  await assert.rejects(
    saveTheme(path.join(root,'library.sqlite'), { title: '../outside', episodes: [] }),
    /invalid filename characters/
  );
});

test('rejects an unsafe collection rename', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-theme-rename-'));
  const db = path.join(root, 'library.sqlite');
  await saveTheme(db, { title: 'Safe', episodes: [] });
  await assert.rejects(renameTheme(db, 'Safe', '../../outside'), /invalid filename characters/);
});

test('theme tags survive save and rename', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-theme-tags-'));
  await saveTheme(path.join(root,'library.sqlite'), { title: 'Tagged', episodes: ['20240101'], tags: { people: ['Alice'] } });
  await renameTheme(path.join(root,'library.sqlite'), 'Tagged', 'Renamed');
  assert.deepEqual(await loadThemes(path.join(root,'library.sqlite')), [{
    title: 'Renamed', episodes: ['20240101'], tags: { people: ['Alice'] }
  }]);
});
