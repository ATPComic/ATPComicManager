import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultVariantAssignmentDraft } from '../public/variant-assignments.js';

test('default arrangement is rebuilt from filenames without mutating the library', () => {
  const episode = {
    files: [
      { name: '20250401_a2.jpg' },
      { name: '20250401_b1.jpg' },
      { name: '20250401_a1.jpg' },
      { name: '20250401_3.jpg' }
    ]
  };
  const library = { episodes: { '20250401': episode }, warnings: [] };

  assert.deepEqual(createDefaultVariantAssignmentDraft(library, '20250401'), {
    a: ['a1', 'a2'],
    b: ['b1'],
    c: []
  });
  assert.deepEqual(episode.files, [
    { name: '20250401_a2.jpg' },
    { name: '20250401_b1.jpg' },
    { name: '20250401_a1.jpg' },
    { name: '20250401_3.jpg' }
  ]);
});

test('default arrangement keeps filename marker tokens out of automatic variants', () => {
  const library = {
    episodes: {
      '20250401': {
        files: [
          { name: '20250401_a1_x.jpg' },
          { name: '20250401_b1.jpg' }
        ]
      }
    }
  };

  assert.deepEqual(createDefaultVariantAssignmentDraft(library, '20250401', ['x']), {
    a: [],
    b: ['b1'],
    c: []
  });
});

test('default arrangement ignores missing file placeholders', () => {
  const library = {
    episodes: {
      '20250401': {
        files: [
          { name: '20250401_a1.jpg' },
          { name: '20250401_a2.jpg', missing: true }
        ]
      }
    }
  };

  assert.deepEqual(createDefaultVariantAssignmentDraft(library, '20250401'), {
    a: ['a1'],
    b: [],
    c: []
  });
});

test('missing episodes fall back to empty default columns', () => {
  assert.deepEqual(createDefaultVariantAssignmentDraft({ episodes: {} }, '20250401'), {
    a: [],
    b: [],
    c: []
  });
});
