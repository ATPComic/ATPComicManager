import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addVariant,
  assignVariantToken,
  createVariantAssignmentDraft,
  findVariantAssignments,
  getEpisodeVariantNames,
  getVariantPageMapping,
  moveVariantToken,
  normalizeVariantAssignments,
  removeVariant,
  removeVariantToken,
  setVariantPageMapping
} from '../public/variant-assignment-model.js';

test('variant state stores only date-scoped trailing sequence tokens', () => {
  const normalized = normalizeVariantAssignments({
    episodes: {
      '20250401': { a: ['1', '2', 'bad_name'], b: ['1_x', '2'], c: [] },
      useless: { a: ['3'] }
    }
  });
  assert.deepEqual(normalized, {
    version: 2,
    episodes: {
      '20250401': { a: ['1', '2'], b: ['1_x', '2'], c: [] }
    },
    peekRelations: {}
  });
});

test('cross-variant assignment copies a token and preserves insertion order', () => {
  const start = { a: ['1', '3'], b: ['1_x'], c: [] };
  const copied = assignVariantToken(start, '3', 'b', 0);
  assert.deepEqual(copied, {
    a: ['1', '3'],
    b: ['3', '1_x'],
    c: []
  });
  assert.deepEqual(removeVariantToken(copied, '3', 'a'), {
    a: ['1'],
    b: ['3', '1_x'],
    c: []
  });
  assert.deepEqual(moveVariantToken(start, '3', 'b', 0, 'a'), {
    a: ['1'],
    b: ['3', '1_x'],
    c: []
  });
  assert.deepEqual(removeVariantToken(start, '1', 'a'), {
    a: ['3'],
    b: ['1_x'],
    c: []
  });
});

test('custom variants persist and a token can belong to several groups', () => {
  const withD = addVariant({ a: ['1'], b: [], c: [] }, 'D');
  const assigned = assignVariantToken(withD, '1', 'd', 0);
  assert.deepEqual(Object.keys(assigned), ['a', 'b', 'c', 'd']);
  assert.deepEqual(findVariantAssignments(assigned, '1'), [
    { variant: 'a', index: 0 },
    { variant: 'd', index: 0 }
  ]);
  assert.deepEqual(normalizeVariantAssignments({ episodes: { '20250401': assigned } }), {
    version: 2,
    episodes: { '20250401': assigned },
    peekRelations: {}
  });
});

test('only empty custom variant columns can be removed', () => {
  const assignments = {
    a: ['1'],
    b: [],
    b_sp1: [],
    c: [],
    d: [],
    e: ['2']
  };
  assert.deepEqual(removeVariant(removeVariant(assignments, 'b_sp1'), 'd'), {
    a: ['1'],
    b: [],
    c: [],
    e: ['2']
  });
  assert.deepEqual(removeVariant(assignments, 'b'), assignments);
  assert.deepEqual(removeVariant(assignments, 'e'), assignments);
});

test('editable draft materializes filename defaults and preserves custom columns', () => {
  const draft = createVariantAssignmentDraft(
    {
      version: 2,
      episodes: { '20250401': { a: [], b: [], c: [], d: [] } },
      peekRelations: { '20250401': { a: 'b', b: null } }
    },
    {
      episodes: {
        '20250401': {
          files: [
            { assignmentToken: 'a1', assignments: [{ variant: 'a', pageNumber: 1 }] },
            { assignmentToken: 'b1_x', assignments: [{ variant: 'b', pageNumber: 1 }] },
            { assignmentToken: 'b2_sp', assignments: [] },
            { assignmentToken: 'b2', assignments: [{ variant: 'b', pageNumber: 2 }] }
          ]
        }
      }
    }
  );
  assert.deepEqual(draft, {
    version: 3,
    episodes: {
      '20250401': { a: ['a1'], b: ['b1_x', 'b2'], c: [], d: [] }
    },
    peekRelations: { '20250401': { a: 'b', b: null } }
  });
});

test('editable draft preserves valid logical-page mappings and removes stale ones', () => {
  const draft = createVariantAssignmentDraft(
    {
      version: 4,
      episodes: {
        '20250401': {
          a: ['a1'],
          a_sp1: ['a5_sp1', 'a6_sp1'],
          b: ['b9'],
          c: []
        }
      },
      pageMappings: {
        '20250401': {
          a_sp1: { a5_sp1: 4, a6_sp1: 5 },
          b: { b9: 4 }
        }
      }
    },
    {
      episodes: {
        '20250401': {
          files: [
            { assignmentToken: 'a1', assignments: [{ variant: 'a', pageNumber: 1 }] },
            { assignmentToken: 'a5_sp1', assignments: [{ variant: 'a_sp1', pageNumber: 4 }] }
          ]
        }
      }
    }
  );

  assert.deepEqual(draft, {
    version: 4,
    episodes: {
      '20250401': {
        a: ['a1'],
        a_sp1: ['a5_sp1'],
        b: [],
        c: []
      }
    },
    peekRelations: {},
    pageMappings: {
      '20250401': { a_sp1: { a5_sp1: 4 } }
    }
  });
});

test('version 3 retains an all-unassigned episode as an authoritative edit', () => {
  assert.deepEqual(normalizeVariantAssignments({
    version: 3,
    episodes: { '20250401': { a: [], b: [], c: [] } }
  }), {
    version: 3,
    episodes: { '20250401': { a: [], b: [], c: [] } },
    peekRelations: {}
  });
});

test('special variants sort naturally and peek relations survive normalization', () => {
  assert.deepEqual(getEpisodeVariantNames({
    c: [],
    b_sp10: [],
    b_sp2: [],
    b: [],
    b_sp01: [],
    b_sp0: [],
    b_sp1: [],
    a: []
  }), ['a', 'b', 'b_sp1', 'b_sp2', 'b_sp10', 'c']);

  assert.deepEqual(normalizeVariantAssignments({
    version: 3,
    episodes: {
      '20250401': {
        b_sp10: ['b2_sp10'],
        b_sp2: ['b2_sp2'],
        d: ['d1'],
        b_sp1: ['b2_sp1']
      }
    },
    peekRelations: {
      '20250401': { B_SP1: 'D', d: 'b_sp2', b_sp2: null, b_sp10: 'b_sp10', b_sp0: 'd' },
      invalid: { a: 'b' }
    }
  }), {
    version: 3,
    episodes: {
      '20250401': {
        a: [],
        b: [],
        b_sp1: ['b2_sp1'],
        b_sp2: ['b2_sp2'],
        b_sp10: ['b2_sp10'],
        c: [],
        d: ['d1']
      }
    },
    peekRelations: {
      '20250401': { b_sp1: 'd', d: 'b_sp2', b_sp2: null }
    }
  });
});

test('manual logical-page mappings are normalized without changing variant token arrays', () => {
  assert.deepEqual(normalizeVariantAssignments({
    version: 3,
    episodes: {
      '20250401': {
        a: ['a1', 'a2', 'a3', 'a4'],
        a_sp1: ['a1_sp1', 'a2_sp1', 'a3_sp1', 'a5_sp1'],
        b: ['b6', 'b7', 'b8', 'b9']
      }
    },
    pageMappings: {
      '20250401': {
        A_SP1: {
          A5_SP1: 4,
          a6_sp1: 0,
          'not a token': 5
        }
      },
      invalid: { a: { a1: 1 } }
    }
  }), {
    version: 4,
    episodes: {
      '20250401': {
        a: ['a1', 'a2', 'a3', 'a4'],
        a_sp1: ['a1_sp1', 'a2_sp1', 'a3_sp1', 'a5_sp1'],
        b: ['b6', 'b7', 'b8', 'b9'],
        c: []
      }
    },
    peekRelations: {},
    pageMappings: {
      '20250401': { a_sp1: { a5_sp1: 4 } }
    }
  });
});

test('logical-page mapping helpers set and reset an explicit override', () => {
  const base = {
    version: 3,
    episodes: {
      '20250401': {
        a: ['a1', 'a2', 'a3', 'a4'],
        a_sp1: ['a1_sp1', 'a2_sp1', 'a3_sp1', 'a5_sp1'],
        b: [],
        c: []
      }
    },
    peekRelations: {}
  };
  const mapped = setVariantPageMapping(base, '20250401', 'A_SP1', 'A5_SP1', 4);

  assert.equal(mapped.version, 4);
  assert.equal(getVariantPageMapping(mapped, '20250401', 'a_sp1', 'a5_sp1'), 4);
  assert.deepEqual(mapped.pageMappings, {
    '20250401': { a_sp1: { a5_sp1: 4 } }
  });

  const reset = setVariantPageMapping(mapped, '20250401', 'a_sp1', 'a5_sp1', null);
  assert.equal(reset.version, 3);
  assert.equal(getVariantPageMapping(reset, '20250401', 'a_sp1', 'a5_sp1'), null);
  assert.equal(Object.hasOwn(reset, 'pageMappings'), false);
});
