import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyPlan } from '../src/apply/apply.js';

function linkPlan(readingRoot, source, target) {
  return {
    readingRoot,
    steps: [{ type: 'create-hard-link', source, target }]
  };
}

test('apply rejects every escaped output path before changing the filesystem', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-apply-path-'));
  const readingRoot = path.join(root, 'Reading');
  const outside = path.join(root, 'outside');

  await assert.rejects(
    applyPlan({
      readingRoot,
      steps: [
        { type: 'create-folder', path: path.join(readingRoot, 'Safe') },
        { type: 'create-folder', path: outside }
      ]
    }),
    /escapes the Reading directory/
  );
  await assert.rejects(fs.access(path.join(readingRoot, 'Safe')));
  await assert.rejects(fs.access(outside));
});

test('apply preserves an unmanaged file instead of overwriting it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-apply-unmanaged-'));
  const readingRoot = path.join(root, 'Reading');
  const source = path.join(root, 'source.jpg');
  const target = path.join(readingRoot, 'Main', '001', '20250401_1a.jpg');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(source, 'new image', 'utf8');
  await fs.writeFile(target, 'keep me', 'utf8');

  await assert.rejects(
    applyPlan(linkPlan(readingRoot, source, target)),
    /unmanaged Reading file/
  );
  assert.equal(await fs.readFile(target, 'utf8'), 'keep me');
});

test('apply atomically replaces a managed hard link and preserves the old source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-apply-managed-'));
  const readingRoot = path.join(root, 'Reading');
  const oldSource = path.join(root, 'old.jpg');
  const nextSource = path.join(root, 'next.jpg');
  const target = path.join(readingRoot, 'Main', '001', '20250401_1a.jpg');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(oldSource, 'old image', 'utf8');
  await fs.writeFile(nextSource, 'new image', 'utf8');
  await fs.link(oldSource, target);

  await applyPlan(linkPlan(readingRoot, nextSource, target));

  assert.equal(await fs.readFile(target, 'utf8'), 'new image');
  assert.equal(await fs.readFile(oldSource, 'utf8'), 'old image');
  assert.deepEqual(
    (await fs.readdir(path.dirname(target))).filter((name) => name.startsWith('.comic-manager-')),
    []
  );
});

test('a missing source cannot remove an existing managed target', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-apply-missing-'));
  const readingRoot = path.join(root, 'Reading');
  const oldSource = path.join(root, 'old.jpg');
  const missingSource = path.join(root, 'missing.jpg');
  const target = path.join(readingRoot, 'Main', '001', '20250401_1a.jpg');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(oldSource, 'old image', 'utf8');
  await fs.link(oldSource, target);

  await assert.rejects(applyPlan(linkPlan(readingRoot, missingSource, target)), /ENOENT/);
  assert.equal(await fs.readFile(target, 'utf8'), 'old image');
});
