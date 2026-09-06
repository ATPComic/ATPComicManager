import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { saveTheme } from '../src/themes/store.js';

test('source CLI scans and exports from an isolated generated workspace without JSON state or plan files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-cli-storage-'));
  const source = path.join(root, 'Archive', '20240101');
  await fs.mkdir(source, {recursive:true});
  await fs.writeFile(path.join(source, '20240101_a1.jpg'), 'fixture');
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const run = command => promisify(execFile)(process.execPath, [cli, command, '--workspace', root], {cwd:root});
  await run('scan');
  await saveTheme(path.join(root, 'library.sqlite'), {title:'Main',episodes:['20240101']});
  await run('apply');
  const index = JSON.parse(await fs.readFile(path.join(root, 'Reading', 'Main', '.theme-index.json'), 'utf8'));
  assert.equal(index.episodes.length, 1);
  assert.equal(await fs.readFile(path.join(root,'Reading','Main','001','20240101_1a.jpg'),'utf8'),'fixture');
  for (const name of ['plan.json','library.json','tags.json','variants.json','themes']) {
    await assert.rejects(fs.access(path.join(root,name)), {code:'ENOENT'});
  }
});
