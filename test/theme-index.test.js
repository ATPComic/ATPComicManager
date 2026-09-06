import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThemeIndex } from '../src/planner/themeIndex.js';

test('builds theme index with relative paths and numeric page ordering', () => {
  const theme = { title: 'Main', episodes: ['20240105'] };
  const library = {
    episodes: {
      '20240105': {
        files: [
          { name: '20240105_a10.jpg', absolutePath: 'D:/secret/20240105_a10.jpg' },
          { name: '20240105_a1.jpg', absolutePath: 'D:/secret/20240105_a1.jpg' },
          { name: '20240105_b2.jpg', absolutePath: 'D:/secret/20240105_b2.jpg' }
        ],
        variants: { a: [1, 10], b: [2] }
      }
    }
  };

  const index = buildThemeIndex(theme, library);
  assert.equal(index.version, 1);
  assert.equal(index.theme, 'Main');
  assert.equal(index.episodes[0].episode, '001');
  assert.equal(index.episodes[0].date, '20240105');
  assert.deepEqual(index.episodes[0].variants.a, [
    { page: 1, file: '001/20240105_1a.jpg' },
    { page: 10, file: '001/20240105_10a.jpg' }
  ]);
  assert.deepEqual(index.episodes[0].variants.b, [
    { page: 2, file: '001/20240105_2b.jpg' }
  ]);
});

test('export retains the title and assigned date of an undated episode', () => {
  const index = buildThemeIndex({ title: 'Extras', episodes: ['custom-extra'] }, {
    episodes: { 'custom-extra': { title: 'Extra chapter', date: '20260906', files: [], variants: {} } }
  });
  assert.equal(index.episodes[0].date, 'custom-extra');
  assert.equal(index.episodes[0].readingDate, '20260906');
  assert.equal(index.episodes[0].title, 'Extra chapter');
});

test('keeps all a/b/c variants when building the theme index', () => {
  const theme = { title: 'Main', episodes: ['20240105'] };
  const library = {
    episodes: {
      '20240105': {
        files: [
          { name: '20240105_a1.jpg', absolutePath: 'D:/secret/20240105_a1.jpg' },
          { name: '20240105_b1.jpg', absolutePath: 'D:/secret/20240105_b1.jpg' },
          { name: '20240105_c1.jpg', absolutePath: 'D:/secret/20240105_c1.jpg' }
        ],
        variants: { a: [1], b: [1], c: [1] }
      }
    }
  };

  const index = buildThemeIndex(theme, library);
  assert.deepEqual(index.episodes[0].variants, {
    a: [{ page: 1, file: '001/20240105_1a.jpg' }],
    b: [{ page: 1, file: '001/20240105_1b.jpg' }],
    c: [{ page: 1, file: '001/20240105_1c.jpg' }]
  });
});

test('omits empty variant keys per episode (a/b only episode keeps no c)', () => {
  const theme = { title: 'Main', episodes: ['20240105', '20240106'] };
  const library = {
    episodes: {
      // Only a/b files exist; the initialized c column is empty.
      '20240105': {
        files: [
          { name: '20240105_a1.jpg', absolutePath: 'D:/secret/20240105_a1.jpg' },
          { name: '20240105_b1.jpg', absolutePath: 'D:/secret/20240105_b1.jpg' }
        ],
        variants: { a: [1], b: [1], c: [] }
      },
      // All three variants contain pages.
      '20240106': {
        files: [
          { name: '20240106_a1.jpg', absolutePath: 'D:/secret/20240106_a1.jpg' },
          { name: '20240106_b1.jpg', absolutePath: 'D:/secret/20240106_b1.jpg' },
          { name: '20240106_c1.jpg', absolutePath: 'D:/secret/20240106_c1.jpg' }
        ],
        variants: { a: [1], b: [1], c: [1] }
      }
    }
  };

  const index = buildThemeIndex(theme, library);
  assert.deepEqual(index.episodes[0].variants, {
    a: [{ page: 1, file: '001/20240105_1a.jpg' }],
    b: [{ page: 1, file: '001/20240105_1b.jpg' }]
  });
  assert.deepEqual(index.episodes[1].variants, {
    a: [{ page: 1, file: '002/20240106_1a.jpg' }],
    b: [{ page: 1, file: '002/20240106_1b.jpg' }],
    c: [{ page: 1, file: '002/20240106_1c.jpg' }]
  });
});

test('indexes copied sources and custom variants independently', () => {
  const index = buildThemeIndex({ title: 'Main', episodes: ['20250401'] }, {
    episodes: {
      '20250401': {
        files: [{
          name: '20250401_info_1.jpg',
          assignments: [
            { variant: 'a', pageNumber: 1 },
            { variant: 'd', pageNumber: 2 }
          ]
        }],
        variants: { a: [1], b: [], c: [], d: [2] }
      }
    }
  });
  assert.deepEqual(index.episodes[0].variants, {
    a: [{ page: 1, file: '001/20250401_1a.jpg' }],
    d: [{ page: 2, file: '001/20250401_2d.jpg' }]
  });
});

test('indexes inherited special pages, their direct overrides, and episode peek relations', () => {
  const files = [
    ['20250401_b1.jpg', 'b', 1],
    ['20250401_b2.jpg', 'b', 2],
    ['20250401_b3.jpg', 'b', 3],
    ['20250401_b2_sp1.jpg', 'b_sp1', 2],
    ['20250401_b2_sp2.jpg', 'b_sp2', 2]
  ].map(([name, variant, pageNumber]) => ({
    name,
    assignments: [{ variant, pageNumber }]
  }));
  const index = buildThemeIndex({ title: 'Main', episodes: ['20250401'] }, {
    episodes: {
      '20250401': {
        files,
        variants: {
          b: [1, 2, 3],
          b_sp1: [1, 2, 3],
          b_sp2: [1, 2, 3]
        },
        peekRelations: { b: 'b_sp1', b_sp1: 'b_sp2', b_sp2: 'b' }
      }
    }
  });

  assert.deepEqual(index.episodes[0], {
    episode: '001',
    date: '20250401',
    title: '20250401',
    readingDate: '20250401',
    title: '20250401',
    readingDate: '20250401',
    variants: {
      b: [
        { page: 1, file: '001/20250401_1b.jpg' },
        { page: 2, file: '001/20250401_2b.jpg' },
        { page: 3, file: '001/20250401_3b.jpg' }
      ],
      b_sp1: [
        { page: 1, file: '001/20250401_1b_sp1.jpg' },
        { page: 2, file: '001/20250401_2b_sp1.jpg' },
        { page: 3, file: '001/20250401_3b_sp1.jpg' }
      ],
      b_sp2: [
        { page: 1, file: '001/20250401_1b_sp2.jpg' },
        { page: 2, file: '001/20250401_2b_sp2.jpg' },
        { page: 3, file: '001/20250401_3b_sp2.jpg' }
      ]
    },
    peekRelations: { b: 'b_sp1', b_sp1: 'b_sp2', b_sp2: 'b' }
  });
});
