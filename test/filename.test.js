import test from 'node:test';
import assert from 'node:assert/strict';
import { getVariantAssignmentToken, parseImageFilename, toReadingFileName } from '../src/validation/filename.js';

test('toReadingFileName moves the variant letter after the page number', () => {
  assert.equal(toReadingFileName('20240105_a1.jpg'), '20240105_1a.jpg');
  assert.equal(toReadingFileName('20240105_b12.jpg'), '20240105_12b.jpg');
  assert.equal(toReadingFileName('20240105_c3_x.jpg'), '20240105_3c_x.jpg');
  assert.equal(toReadingFileName('20240105_A2.JPG'), '20240105_2a.JPG');
  assert.equal(toReadingFileName('notes.txt'), 'notes.txt');
});

test('reading names are not re-parsed as source names', () => {
  assert.equal(parseImageFilename('20240105_1a.jpg'), null);
  assert.equal(parseImageFilename('20240105_a1.jpg').pageNumber, 1);
});

test('common image extensions are parsed and preserved in reading names', () => {
  for (const extension of ['png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif']) {
    const source = `20240105_a1.${extension}`;
    assert.equal(parseImageFilename(source)?.variant, 'a');
    assert.equal(toReadingFileName(source), `20240105_1a.${extension}`);
  }
});

test('undated numeric files receive unique reading names after manual assignment', () => {
  assert.equal(toReadingFileName('001.jpg', { variant: 'a', pageNumber: 1 }), '1a.jpg');
  assert.equal(toReadingFileName('001.jpg', { variant: 'b', pageNumber: 1 }), '1b.jpg');
});

test('explicit source names accept custom single-letter variants', () => {
  assert.deepEqual(parseImageFilename('20250401_d12.jpg'), {
    episodeId: '20250401',
    variant: 'd',
    pageNumber: 12,
    fileName: '20250401_d12.jpg',
    assignmentToken: 'd12',
    hasVariantSuffix: false,
    requiresVariantAssignment: false
  });
});

test('source names use only the leading date and trailing sequence token', () => {
  const examples = [
    ['20250401_useless_info_a2.jpg', 'a', 2, false, 'a2'],
    ['20250401_info_b1_x.jpg', 'b', 1, true, 'b1_x'],
    ['20250401_uselessinfo_A1.jpg', 'a', 1, false, 'a1'],
    ['20250401_some_info_b2_sp.jpg', null, 2, false, 'b2_sp'],
    ['20250501_useless_info_2.jpg', null, 2, false, '2'],
    ['20250501_some_info_3.jpg', null, 3, false, '3'],
    ['20250501_info_1_x.jpg', null, 1, true, '1_x']
  ];
  for (const [fileName, variant, pageNumber, hasVariantSuffix, token] of examples) {
    const parsed = parseImageFilename(fileName);
    assert.match(parsed.episodeId, /^20250[45]01$/);
    assert.equal(parsed.variant, variant);
    assert.equal(parsed.pageNumber, pageNumber);
    assert.equal(parsed.hasVariantSuffix, hasVariantSuffix);
    assert.equal(getVariantAssignmentToken(parsed), token);
  }
});

test('configured markers remain part of file identity and require manual assignment', () => {
  const markers = ['noEffect', 'no_effects'];
  const examples = [
    ['20250601_noEffect_A1.jpg', 'a1_noeffect', 1, false],
    ['20250601_A1.jpg', 'a1', 1, true],
    ['20250601_no_effects_A1.jpg', 'a1_no_effects', 1, false],
    ['20250601_2_no_effects.jpg', '2_no_effects', 2, false],
    ['20250601_2.jpg', '2', 2, false]
  ];

  for (const [fileName, assignmentToken, pageNumber, hasAutomaticVariant] of examples) {
    const parsed = parseImageFilename(fileName, markers);
    assert.equal(parsed.assignmentToken, assignmentToken);
    assert.equal(parsed.pageNumber, pageNumber);
    assert.equal(Boolean(parsed.variant), hasAutomaticVariant);
    assert.equal(parsed.requiresVariantAssignment, !hasAutomaticVariant);
  }

  assert.notEqual(
    getVariantAssignmentToken(parseImageFilename('20250601_noEffect_A1.jpg', markers)),
    getVariantAssignmentToken(parseImageFilename('20250601_A1.jpg', markers))
  );
  assert.notEqual(
    getVariantAssignmentToken(parseImageFilename('20250601_2_no_effects.jpg', markers)),
    getVariantAssignmentToken(parseImageFilename('20250601_2.jpg', markers))
  );
});

test('manual assignments control canonical reading names without retaining middle text', () => {
  assert.equal(
    toReadingFileName('20250401_useless_info_2.jpg', { variant: 'b', pageNumber: 1 }),
    '20250401_1b.jpg'
  );
  assert.equal(
    toReadingFileName('20250401_info_1_x.jpg', { variant: 'c', pageNumber: 4 }),
    '20250401_4c_x.jpg'
  );
});

test('special variant suffixes remain complete manual-assignment tokens', () => {
  assert.deepEqual(parseImageFilename('20250401_middle_b2_sp1.jpg'), {
    episodeId: '20250401',
    variant: null,
    pageNumber: 2,
    fileName: '20250401_middle_b2_sp1.jpg',
    assignmentToken: 'b2_sp1',
    hasVariantSuffix: false,
    requiresVariantAssignment: true
  });
  assert.deepEqual(parseImageFilename('20250401_middle_b2_sp2_x.jpg'), {
    episodeId: '20250401',
    variant: null,
    pageNumber: 2,
    fileName: '20250401_middle_b2_sp2_x.jpg',
    assignmentToken: 'b2_sp2_x',
    hasVariantSuffix: true,
    requiresVariantAssignment: true
  });

  for (const token of ['b2_sp0', 'b2_sp01']) {
    const parsed = parseImageFilename(`20250401_middle_${token}.jpg`);
    assert.equal(parsed.variant, null);
    assert.equal(parsed.assignmentToken, token);
    assert.equal(parsed.requiresVariantAssignment, true);
  }

  assert.equal(toReadingFileName('20250401_middle_b2_sp1.jpg'), '20250401_middle_b2_sp1.jpg');
  assert.equal(toReadingFileName('20250401_middle_b2_sp2_x.jpg'), '20250401_middle_b2_sp2_x.jpg');
  assert.equal(
    toReadingFileName('20250401_middle_b2_sp1.jpg', { variant: 'b_sp1', pageNumber: 2 }),
    '20250401_2b_sp1.jpg'
  );
  assert.equal(
    toReadingFileName('20250401_middle_b2_sp2_x.jpg', { variant: 'b_sp2', pageNumber: 2 }),
    '20250401_2b_sp2_x.jpg'
  );
});
