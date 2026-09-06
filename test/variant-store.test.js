import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadVariantAssignments, saveVariantAssignments } from '../src/variant-store.js';

test('variant assignment persistence keeps only date keys and trailing sequence tokens', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-variants-'));
  const filePath = path.join(root, 'library.sqlite');
  const saved = await saveVariantAssignments(filePath, {
    version: 1,
    episodes: {
      '20250401': {
        a: ['20250401_uselessinfo_A1.jpg', '1', '2'],
        b: ['1_x', '2'],
        c: ['3'],
        d: []
      },
      'not-a-date': { a: ['4'], b: [], c: [] }
    },
    peekRelations: {
      '20250401': { B: 'D', d: 'a', c: null, b_sp0: 'a' },
      'not-a-date': { a: 'b' }
    }
  });

  assert.deepEqual(saved, {
    version: 2,
    episodes: {
      '20250401': { a: ['1', '2'], b: ['1_x', '2'], c: ['3'], d: [] }
    },
    peekRelations: {
      '20250401': { b: 'd', d: 'a', c: null }
    }
  });
  assert.deepEqual(await loadVariantAssignments(filePath), saved);
});

test('variant assignment persistence round-trips explicit logical-page overrides', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-variant-pages-'));
  const filePath = path.join(root, 'library.sqlite');
  const saved = await saveVariantAssignments(filePath, {
    version: 3,
    episodes: {
      '20250401': {
        a: ['a1', 'a2', 'a3', 'a4'],
        a_sp1: ['a1_sp1', 'a2_sp1', 'a3_sp1', 'a5_sp1'],
        b: ['b6', 'b7', 'b8', 'b9'],
        c: []
      }
    },
    pageMappings: {
      '20250401': { A_SP1: { A5_SP1: 4 } }
    }
  });

  assert.equal(saved.version, 4);
  assert.deepEqual(saved.episodes['20250401'].a_sp1, ['a1_sp1', 'a2_sp1', 'a3_sp1', 'a5_sp1']);
  assert.deepEqual(saved.pageMappings, {
    '20250401': { a_sp1: { a5_sp1: 4 } }
  });
  assert.deepEqual(await loadVariantAssignments(filePath), saved);
});

test('a damaged Variant state is reported instead of being treated as empty', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-variant-damaged-'));
  const filePath = path.join(root, 'library.sqlite');
  await fs.writeFile(filePath, '{"episodes":', 'utf8');

  await assert.rejects(
    loadVariantAssignments(filePath),
    /not a database/
  );
  assert.equal(await fs.readFile(filePath, 'utf8'), '{"episodes":');
});

test('Variant state replacement leaves no temporary files behind', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-variant-atomic-'));
  const filePath = path.join(root, 'library.sqlite');
  await saveVariantAssignments(filePath, { version: 3, episodes: {}, peekRelations: {} });
  await saveVariantAssignments(filePath, {
    version: 3,
    episodes: { '20250401': { a: ['1'], b: [], c: [] } },
    peekRelations: {}
  });

  assert.deepEqual(await fs.readdir(root), ['library.sqlite']);
  assert.deepEqual((await loadVariantAssignments(filePath)).episodes['20250401'].a, ['1']);
});
