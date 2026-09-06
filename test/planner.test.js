import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlan } from '../src/planner/planner.js';

const fixturePath = value => path.join(os.tmpdir(), 'atp-planner-fixture', value).replaceAll('\\', '/');

test('creates hard-link plan for themed episodes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-'));
  const readingRoot = path.join(root, 'Reading');
  const archiveRoot = path.join(root, 'Archive');
  const source = path.join(archiveRoot, '20240105');
  await fs.mkdir(source, { recursive: true });
  const filePath = path.join(source, '20240105_a1.jpg');
  await fs.writeFile(filePath, 'x');

  const library = {
    warnings: [],
    episodes: {
      '20240105': {
        source,
        layout: 'folder',
        files: [{ name: '20240105_a1.jpg', absolutePath: filePath, relativePath: 'Archive/20240105/20240105_a1.jpg' }],
        variants: { a: [1], b: [] }
      }
    }
  };

  const plan = createPlan(library, [{ title: 'Main', episodes: ['20240105'] }], { readingRoot });
  assert.equal(plan.steps[0].type, 'create-folder');
  assert.equal(plan.steps[1].type, 'create-folder');
  assert.equal(plan.steps.at(-1).type, 'write-theme-index');
  assert.match(JSON.stringify(plan.steps), /Reading\/Main\/001/);
  assert.match(JSON.stringify(plan.steps), /Reading\/Main\/001\/20240105_1a\.jpg/);
});

test('refuses to create a plan outside the configured Reading directory', () => {
  assert.throws(
    () => createPlan(
      { warnings: [], episodes: {} },
      [{ title: '../../outside', episodes: [] }],
      { readingRoot: fixturePath('Workspace/Reading') }
    ),
    /escapes the Reading directory/
  );
});

test('manual variant order is reflected in hard-link names without source middle text', () => {
  const library = {
    warnings: [],
    episodes: {
      '20250401': {
        files: [
          { name: '20250401_some_info_3.jpg', absolutePath: fixturePath('Archive/20250401_some_info_3.jpg'), variant: 'a', pageNumber: 2 },
          { name: '20250401_uselessinfo_A1.jpg', absolutePath: fixturePath('Archive/20250401_uselessinfo_A1.jpg'), variant: 'a', pageNumber: 1 },
          { name: '20250401_info_1_x.jpg', absolutePath: fixturePath('Archive/20250401_info_1_x.jpg'), variant: 'b', pageNumber: 1 }
        ],
        variants: { a: [1, 2], b: [1], c: [] }
      }
    }
  };
  const plan = createPlan(library, [{ title: 'Main', episodes: ['20250401'] }], { readingRoot: fixturePath('Reading') });
  const targets = plan.steps.filter((step) => step.type === 'create-hard-link').map((step) => step.target);
  assert.deepEqual(targets, [
    fixturePath('Reading/Main/001/20250401_1a.jpg'),
    fixturePath('Reading/Main/001/20250401_2a.jpg'),
    fixturePath('Reading/Main/001/20250401_1b_x.jpg')
  ]);
});

test('one source file creates hard links in multiple and custom variants', () => {
  const source = fixturePath('Archive/20250401_info_1.jpg');
  const library = {
    warnings: [],
    episodes: {
      '20250401': {
        files: [{
          name: '20250401_info_1.jpg',
          absolutePath: source,
          assignments: [
            { variant: 'a', pageNumber: 1 },
            { variant: 'b', pageNumber: 2 },
            { variant: 'd', pageNumber: 1 }
          ]
        }],
        variants: { a: [1], b: [2], c: [], d: [1] }
      }
    }
  };
  const plan = createPlan(library, [{ title: 'Main', episodes: ['20250401'] }], { readingRoot: fixturePath('Reading') });
  const links = plan.steps.filter((step) => step.type === 'create-hard-link');
  assert.deepEqual(links.map(({ source: linkSource, target }) => ({ source: linkSource, target })), [
    { source, target: fixturePath('Reading/Main/001/20250401_1a.jpg') },
    { source, target: fixturePath('Reading/Main/001/20250401_2b.jpg') },
    { source, target: fixturePath('Reading/Main/001/20250401_1d.jpg') }
  ]);
});

test('sparse special variants create complete hard-link sets with only their override page replaced', () => {
  const files = [
    ['20250401_b1.jpg', fixturePath('Archive/20250401_b1.jpg'), 'b', 1],
    ['20250401_b2.jpg', fixturePath('Archive/20250401_b2.jpg'), 'b', 2],
    ['20250401_b3.jpg', fixturePath('Archive/20250401_b3.jpg'), 'b', 3],
    ['20250401_b2_sp1.jpg', fixturePath('Archive/20250401_b2_sp1.jpg'), 'b_sp1', 2],
    ['20250401_b2_sp2.jpg', fixturePath('Archive/20250401_b2_sp2.jpg'), 'b_sp2', 2]
  ].map(([name, absolutePath, variant, pageNumber]) => ({
    name,
    absolutePath,
    assignments: [{ variant, pageNumber }]
  }));
  const library = {
    warnings: [],
    episodes: {
      '20250401': {
        files,
        variants: {
          b: [1, 2, 3],
          b_sp1: [1, 2, 3],
          b_sp2: [1, 2, 3]
        }
      }
    }
  };

  const plan = createPlan(library, [{ title: 'Main', episodes: ['20250401'] }], { readingRoot: fixturePath('Reading') });
  const links = plan.steps
    .filter((step) => step.type === 'create-hard-link')
    .map(({ source, target }) => ({ source, target }));
  assert.deepEqual(links, [
    { source: fixturePath('Archive/20250401_b1.jpg'), target: fixturePath('Reading/Main/001/20250401_1b.jpg') },
    { source: fixturePath('Archive/20250401_b2.jpg'), target: fixturePath('Reading/Main/001/20250401_2b.jpg') },
    { source: fixturePath('Archive/20250401_b3.jpg'), target: fixturePath('Reading/Main/001/20250401_3b.jpg') },
    { source: fixturePath('Archive/20250401_b1.jpg'), target: fixturePath('Reading/Main/001/20250401_1b_sp1.jpg') },
    { source: fixturePath('Archive/20250401_b2_sp1.jpg'), target: fixturePath('Reading/Main/001/20250401_2b_sp1.jpg') },
    { source: fixturePath('Archive/20250401_b3.jpg'), target: fixturePath('Reading/Main/001/20250401_3b_sp1.jpg') },
    { source: fixturePath('Archive/20250401_b1.jpg'), target: fixturePath('Reading/Main/001/20250401_1b_sp2.jpg') },
    { source: fixturePath('Archive/20250401_b2_sp2.jpg'), target: fixturePath('Reading/Main/001/20250401_2b_sp2.jpg') },
    { source: fixturePath('Archive/20250401_b3.jpg'), target: fixturePath('Reading/Main/001/20250401_3b_sp2.jpg') }
  ]);
});

test('explicit logical pages create no hard link for an irregular source suffix', () => {
  const baseFiles = [1, 2, 3, 4].map((pageNumber) => ({
    name: `20250401_a${pageNumber}.jpg`,
    absolutePath: fixturePath(`Archive/20250401_a${pageNumber}.jpg`),
    assignments: [{ variant: 'a', pageNumber }]
  }));
  const specialFiles = [
    ['a1_sp1', 1],
    ['a2_sp1', 2],
    ['a3_sp1', 3],
    ['a5_sp1', 4]
  ].map(([token, pageNumber]) => ({
    name: `20250401_${token}.jpg`,
    absolutePath: fixturePath(`Archive/20250401_${token}.jpg`),
    assignments: [{ variant: 'a_sp1', pageNumber }]
  }));
  const library = {
    warnings: [],
    episodes: {
      '20250401': {
        files: [...baseFiles, ...specialFiles],
        variants: {
          a: [1, 2, 3, 4],
          a_sp1: [1, 2, 3, 4]
        }
      }
    }
  };

  const plan = createPlan(library, [{ title: 'Main', episodes: ['20250401'] }], { readingRoot: fixturePath('Reading') });
  const specialLinks = plan.steps
    .filter((step) => step.type === 'create-hard-link' && step.target.includes('a_sp1'))
    .map(({ source, target }) => ({ source, target }));

  assert.deepEqual(specialLinks, [
    { source: fixturePath('Archive/20250401_a1_sp1.jpg'), target: fixturePath('Reading/Main/001/20250401_1a_sp1.jpg') },
    { source: fixturePath('Archive/20250401_a2_sp1.jpg'), target: fixturePath('Reading/Main/001/20250401_2a_sp1.jpg') },
    { source: fixturePath('Archive/20250401_a3_sp1.jpg'), target: fixturePath('Reading/Main/001/20250401_3a_sp1.jpg') },
    { source: fixturePath('Archive/20250401_a5_sp1.jpg'), target: fixturePath('Reading/Main/001/20250401_4a_sp1.jpg') }
  ]);
  assert.equal(plan.steps.some((step) => step.type === 'create-hard-link' && /20250401_5a_sp1\.jpg$/.test(step.target)), false);
});
