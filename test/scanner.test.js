import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanArchive, scanWorkspace } from '../src/scanner/scanner.js';

async function createFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'x');
}

test('scans folder layout and reports validation issues', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-'));
  const archive = path.join(root, 'Archive');
  await createFile(path.join(archive, '20240105', '20240105_a1.jpg'));
  await createFile(path.join(archive, '20240105', '20240105_a2.jpg'));
  await createFile(path.join(archive, '20240105', '20240105_a5.jpg'));
  await createFile(path.join(archive, '20240105', '20240106_a1.jpg'));
  await createFile(path.join(archive, '20240105_x', '20240105_a1.jpg'));

  const library = await scanArchive(archive, root);
  assert.ok(library.episodes['20240105']);
  assert.match(JSON.stringify(library.warnings), /folder-conflict/);
  assert.match(JSON.stringify(library.warnings), /folder-file-date-mismatch/);
  assert.match(JSON.stringify(library.warnings), /missing-pages/);
});

test('scans month-flat layout into virtual episodes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-'));
  const archive = path.join(root, 'Archive');
  await createFile(path.join(archive, '202401', '20240105_a1.jpg'));
  await createFile(path.join(archive, '202401', '20240105_a3.jpg'));
  await createFile(path.join(archive, '202401', '20240118_b1.jpg'));

  const library = await scanArchive(archive, root);
  assert.ok(library.episodes['20240105']);
  assert.ok(library.episodes['20240118']);
  assert.equal(library.episodes['20240105'].layout, 'month-flat');
  assert.match(JSON.stringify(library.warnings), /missing-pages/);
});

test('discovers archive-like workspace subfolders automatically', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-'));
  const sourceRoot = path.join(root, 'Comics');
  await createFile(path.join(sourceRoot, 'SetA', '20240105', '20240105_a1.jpg'));
  await createFile(path.join(sourceRoot, 'SetA', '20240105', '20240105_a2.jpg'));

  const library = await scanWorkspace(root);
  assert.ok(library.episodes['20240105']);
  assert.match(JSON.stringify(library.meta ?? {}), /Comics/);
});

test('sorts image files by numeric page order', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-'));
  const archive = path.join(root, 'Archive');
  await createFile(path.join(archive, '20240105', '20240105_a10.jpg'));
  await createFile(path.join(archive, '20240105', '20240105_a1.jpg'));
  await createFile(path.join(archive, '20240105', '20240105_a2.jpg'));

  const library = await scanArchive(archive, root);
  assert.deepEqual(library.episodes['20240105'].files.map((file) => file.name), [
    '20240105_a1.jpg',
    '20240105_a2.jpg',
    '20240105_a10.jpg'
  ]);
});

test('scans common image extensions beyond JPEG', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-images-'));
  const archive = path.join(root, 'Archive');
  const names = ['20240105_a1.png', '20240105_a2.webp', '20240105_a3.gif', '20240105_a4.bmp', '20240105_a5.tif', '20240105_a6.tiff', '20240105_a7.avif'];
  for (const name of names) await createFile(path.join(archive, '20240105', name));

  const library = await scanArchive(archive, root);
  assert.deepEqual(library.episodes['20240105'].files.map((file) => file.name), names);
  assert.doesNotMatch(JSON.stringify(library.warnings), /invalid-filename/);
});

test('mixed default and manual names stay fully editable by stable suffix token', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-'));
  const archive = path.join(root, 'Archive');
  const examples = {
    '202504': [
      '20250401_useless_info_a2.jpg',
      '20250401_uselessinfo_a1.jpg',
      '20250401_some_info_b2_sp.jpg',
      '20250401_some_info_b2.jpg',
      '20250401_info_b1_x.jpg'
    ],
    '202505': [
      '20250501_useless_info_2.jpg',
      '20250501_uselessinfo_A2.jpg',
      '20250501_uselessinfo_A1.jpg',
      '20250501_some_info_3.jpg',
      '20250501_info_1_x.jpg'
    ]
  };
  for (const [month, fileNames] of Object.entries(examples)) {
    for (const fileName of fileNames) await createFile(path.join(archive, month, fileName));
  }

  const defaults = await scanArchive(archive, root);
  assert.deepEqual(defaults.episodes['20250401'].variants, { a: [1, 2], b: [1, 2], c: [] });
  assert.deepEqual(defaults.episodes['20250501'].variants, { a: [1, 2], b: [], c: [] });
  assert.deepEqual(new Set(defaults.episodes['20250401'].files.map((file) => file.assignmentToken)), new Set(['a1', 'a2', 'b1_x', 'b2', 'b2_sp']));
  assert.deepEqual(new Set(defaults.episodes['20250501'].files.map((file) => file.assignmentToken)), new Set(['a1', 'a2', '1_x', '2', '3']));
  assert.match(JSON.stringify(defaults.warnings), /b2_sp/);
  assert.match(JSON.stringify(defaults.warnings), /20250501/);
  const sourceOrder = defaults.episodes['20250401'].files.map((file) => file.name);

  const assigned = await scanArchive(archive, root, {
    version: 3,
    episodes: {
      '20250401': { a: ['a1', 'a2'], b: ['b1_x', 'b2_sp', 'b2'], c: [] },
      '20250501': { a: ['1_x', '2', '3'], b: ['a1', 'a2'], c: [] }
    }
  });
  assert.deepEqual(assigned.episodes['20250401'].variants, { a: [1, 2], b: [1, 2, 3], c: [] });
  assert.deepEqual(assigned.episodes['20250501'].variants, { a: [1, 2, 3], b: [1, 2], c: [] });
  assert.deepEqual(assigned.episodes['20250401'].files.map((file) => file.name), sourceOrder);
  const aprilAssignments = Object.fromEntries(assigned.episodes['20250401'].files.map((file) => [file.assignmentToken, file.assignments]));
  assert.deepEqual(aprilAssignments.b2_sp, [{ variant: 'b', pageNumber: 2 }]);
  assert.deepEqual(aprilAssignments.b2, [{ variant: 'b', pageNumber: 3 }]);
  const mayAssignments = Object.fromEntries(assigned.episodes['20250501'].files.map((file) => [file.assignmentToken, file.assignments]));
  assert.deepEqual(mayAssignments.a1, [{ variant: 'b', pageNumber: 1 }]);
  assert.deepEqual(mayAssignments['1_x'], [{ variant: 'a', pageNumber: 1 }]);
});

test('configured markers keep distinct manual-assignment identities', async () => {
  const options = { recognition: { identityMarkers: ['noEffect', 'no_effects'] } };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-no-effects-'));
  const archive = path.join(root, 'Archive');
  for (const fileName of [
    '20250601_noEffect_A1.jpg',
    '20250601_A1.jpg',
    '20250601_2_no_effects.jpg',
    '20250601_2.jpg',
    '20250601_1_x.jpg'
  ]) {
    await createFile(path.join(archive, '202506', fileName));
  }

  const defaults = await scanArchive(archive, root, null, options);
  const defaultEpisode = defaults.episodes['20250601'];
  assert.deepEqual(new Set(defaultEpisode.files.map((file) => file.assignmentToken)), new Set([
    'a1_noeffect', 'a1', '2_no_effects', '2', '1_x'
  ]));
  assert.deepEqual(defaultEpisode.variants, { a: [1], b: [], c: [] });
  assert.equal(defaultEpisode.files.find((file) => file.assignmentToken === 'a1_noeffect').variantSource, 'unassigned');
  assert.doesNotMatch(JSON.stringify(defaults.warnings), /ambiguous-variant-token/);

  const assigned = await scanArchive(archive, root, {
    version: 3,
    episodes: {
      '20250601': {
        a: ['a1', '2', '1_x'],
        b: ['a1_noeffect', '2_no_effects'],
        c: []
      }
    }
  }, options);
  const assignments = Object.fromEntries(assigned.episodes['20250601'].files
    .map((file) => [file.assignmentToken, file.assignments]));
  assert.deepEqual(assignments.a1, [{ variant: 'a', pageNumber: 1 }]);
  assert.deepEqual(assignments.a1_noeffect, [{ variant: 'b', pageNumber: 1 }]);
  assert.deepEqual(assignments['2_no_effects'], [{ variant: 'b', pageNumber: 2 }]);
});

test('one generic image can fill several variants including custom groups', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-multi-variant-'));
  const archive = path.join(root, 'Archive');
  for (const fileName of [
    '20250401_info_1.jpg',
    '20250401_info_2.jpg',
    '20250401_info_3.jpg'
  ]) {
    await createFile(path.join(archive, '202504', fileName));
  }

  const library = await scanArchive(archive, root, {
    episodes: {
      '20250401': {
        a: ['1', '2', '3'],
        b: ['1', '2', '3'],
        c: [],
        d: ['1', '2', '3']
      }
    }
  });
  assert.deepEqual(library.episodes['20250401'].variants, {
    a: [1, 2, 3], b: [1, 2, 3], c: [], d: [1, 2, 3]
  });
  assert.deepEqual(library.episodes['20250401'].files[0].assignments, [
    { variant: 'a', pageNumber: 1 },
    { variant: 'b', pageNumber: 1 },
    { variant: 'd', pageNumber: 1 }
  ]);
  assert.doesNotMatch(JSON.stringify(library.warnings), /missing-pages|variant-mismatch/);
});

test('an edited version 3 episode can explicitly leave filename defaults unassigned', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-authoritative-'));
  const archive = path.join(root, 'Archive');
  await createFile(path.join(archive, '202504', '20250401_middle_a1.jpg'));
  const library = await scanArchive(archive, root, {
    version: 3,
    episodes: { '20250401': { a: [], b: [], c: [] } }
  });
  assert.deepEqual(library.episodes['20250401'].variants, { a: [], b: [], c: [] });
  assert.equal(library.episodes['20250401'].files[0].variantSource, 'unassigned');
});

test('manually assigned sparse special variants inherit every non-overridden base page', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-special-variant-'));
  const archive = path.join(root, 'Archive');
  for (const fileName of [
    '20250401_b1.jpg',
    '20250401_b2.jpg',
    '20250401_b3.jpg',
    '20250401_b2_sp1.jpg',
    '20250401_b2_sp2.jpg'
  ]) {
    await createFile(path.join(archive, '202504', fileName));
  }

  const library = await scanArchive(archive, root, {
    version: 3,
    episodes: {
      '20250401': {
        a: [],
        b: ['b1', 'b2', 'b3'],
        b_sp1: ['b2_sp1'],
        b_sp2: ['b2_sp2'],
        c: []
      }
    }
  });
  const episode = library.episodes['20250401'];
  assert.deepEqual(episode.variants, {
    a: [],
    b: [1, 2, 3],
    b_sp1: [1, 2, 3],
    b_sp2: [1, 2, 3],
    c: []
  });
  assert.deepEqual(
    Object.fromEntries(episode.files.map((file) => [file.assignmentToken, file.assignments])),
    {
      b1: [{ variant: 'b', pageNumber: 1 }],
      b2: [{ variant: 'b', pageNumber: 2 }],
      b3: [{ variant: 'b', pageNumber: 3 }],
      b2_sp1: [{ variant: 'b_sp1', pageNumber: 2 }],
      b2_sp2: [{ variant: 'b_sp2', pageNumber: 2 }]
    }
  );
  assert.doesNotMatch(JSON.stringify(library.warnings), /missing-pages|variant-mismatch/);
});

test('a special-variant string token automatically uses its source page number', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-special-auto-page-'));
  const archive = path.join(root, 'Archive');
  for (const fileName of [
    '20250401_b1.jpg',
    '20250401_b2.jpg',
    '20250401_b3.jpg',
    '20250401_b2_xxxxx.jpg'
  ]) {
    await createFile(path.join(archive, '202504', fileName));
  }

  const library = await scanArchive(archive, root, {
    version: 3,
    episodes: {
      '20250401': {
        a: [],
        b: ['b1', 'b2', 'b3'],
        b_sp1: ['b2_xxxxx'],
        c: []
      }
    }
  });
  const episode = library.episodes['20250401'];
  const specialFile = episode.files.find((file) => file.assignmentToken === 'b2_xxxxx');

  assert.deepEqual(specialFile.assignments, [{ variant: 'b_sp1', pageNumber: 2 }]);
  assert.deepEqual(episode.variants.b_sp1, [1, 2, 3]);
});

test('an explicit page override aligns irregular special tokens while normal variants follow column order', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-special-manual-page-'));
  const archive = path.join(root, 'Archive');
  for (const fileName of [
    '20250401_a1.jpg',
    '20250401_a2.jpg',
    '20250401_a3.jpg',
    '20250401_a4.jpg',
    '20250401_a1_sp1.jpg',
    '20250401_a2_sp1.jpg',
    '20250401_a3_sp1.jpg',
    '20250401_a5_sp1.jpg',
    '20250401_b6.jpg',
    '20250401_b7.jpg',
    '20250401_b8.jpg',
    '20250401_b9.jpg'
  ]) {
    await createFile(path.join(archive, '202504', fileName));
  }

  const library = await scanArchive(archive, root, {
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
      '20250401': { a_sp1: { a5_sp1: 4 } }
    }
  });
  const episode = library.episodes['20250401'];
  const assignments = Object.fromEntries(episode.files.map((file) => [file.assignmentToken, file.assignments]));

  assert.deepEqual(episode.variants, {
    a: [1, 2, 3, 4],
    a_sp1: [1, 2, 3, 4],
    b: [1, 2, 3, 4],
    c: []
  });
  assert.deepEqual(assignments.a5_sp1, [{ variant: 'a_sp1', pageNumber: 4 }]);
  assert.deepEqual(assignments.b6, [{ variant: 'b', pageNumber: 1 }]);
  assert.deepEqual(assignments.b9, [{ variant: 'b', pageNumber: 4 }]);
  assert.doesNotMatch(JSON.stringify(library.warnings), /missing-pages|variant-mismatch/);
});

test('workspace finalizes variants after merging roots so base and special files can be split', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-special-roots-'));
  await createFile(path.join(root, 'SetA', '202504', '20250401_b1.jpg'));
  await createFile(path.join(root, 'SetA', '202504', '20250401_b2.jpg'));
  await createFile(path.join(root, 'SetB', '202504', '20250401_b2_sp1.jpg'));

  const library = await scanWorkspace(root, null, {
    version: 3,
    episodes: {
      '20250401': { a: [], b: ['b1', 'b2'], b_sp1: ['b2_sp1'], c: [] }
    },
    peekRelations: { '20250401': { b_sp1: 'b' } }
  });

  assert.deepEqual(library.episodes['20250401'].variants.b_sp1, [1, 2]);
  assert.deepEqual(library.episodes['20250401'].peekRelations, { b_sp1: 'b' });
  assert.doesNotMatch(JSON.stringify(library.warnings), /missing-pages|variant-mismatch|special-variant-base-missing/);
});

test('recognition rules scan undated folders with numeric names and stable manual assignments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-undated-'));
  const archive = path.join(root, 'Archive');
  await createFile(path.join(archive, 'Bonus-special', '001.jpg'));
  await createFile(path.join(archive, 'Bonus-special', 'page-2.jpg'));
  const episodeId = 'folder:Archive/Bonus-special';
  const recognition = {
    version: 1,
    rules: [{ id: 'bonus', prefix: 'Bonus-', suffix: '-special' }],
    episodeDates: { [episodeId]: '2022-08-09' }
  };
  const library = await scanWorkspace(root, archive, {
    version: 3,
    episodes: { [episodeId]: { a: ['001', '2'], b: [], c: [] } }
  }, recognition);
  assert.equal(library.episodes[episodeId].title, 'Bonus-special');
  assert.equal(library.episodes[episodeId].date, '2022-08-09');
  assert.deepEqual(library.episodes[episodeId].variants.a, [1, 2]);
  assert.deepEqual(library.episodes[episodeId].files.map((file) => file.assignmentToken), ['001', '2']);
});
