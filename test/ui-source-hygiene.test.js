import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(projectRoot, 'public');

test('business scripts contain neither localized Han text nor embedded SVG source', async () => {
  const fileNames = (await fs.readdir(publicRoot))
    .filter((fileName) => fileName.endsWith('.js') && fileName !== 'i18n.js');

  for (const fileName of fileNames) {
    const source = await fs.readFile(path.join(publicRoot, fileName), 'utf8');
    assert.doesNotMatch(source, /\p{Script=Han}/u, `${fileName} contains localized Han text`);
    assert.doesNotMatch(source, /<svg\b/i, `${fileName} embeds SVG source`);
  }
});

test('each i18n dictionary entry occupies its own line', async () => {
  const source = await fs.readFile(path.join(publicRoot, 'i18n.js'), 'utf8');
  const dictionarySource = source.slice(0, source.indexOf('export const locale'));

  for (const [index, line] of dictionarySource.split(/\r?\n/).entries()) {
    const entries = line.match(/\b[A-Za-z][A-Za-z0-9]*:\s*'/g) ?? [];
    assert.ok(entries.length <= 1, `line ${index + 1} contains multiple translations`);
  }
});
