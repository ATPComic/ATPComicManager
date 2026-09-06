import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextVariantPage } from '../neeview/variant.js';

const episode = {
  variants: {
    a: [{ page: 1, file: '1a.jpg' }, { page: 2, file: '2a.jpg' }],
    b: [{ page: 1, file: '1b.jpg' }],
    c: [{ page: 1, file: '1c.jpg' }, { page: 2, file: '2c.jpg' }]
  }
};

test('peek advances to the immediate variant without wrapping', () => {
  assert.deepEqual(getNextVariantPage(episode, 'a', 1), {
    variant: 'b', page: 1, file: '1b.jpg'
  });
  assert.deepEqual(getNextVariantPage(episode, 'b', 1), {
    variant: 'c', page: 1, file: '1c.jpg'
  });
  assert.equal(getNextVariantPage(episode, 'c', 1), null);
});

test('peek requires the same page in the immediate variant', () => {
  assert.equal(getNextVariantPage(episode, 'a', 2), null);
});

test('peek follows an episode-specific relation without requiring forward order', () => {
  const related = {
    ...episode,
    peekRelations: { c: 'a', a: 'c' }
  };
  assert.deepEqual(getNextVariantPage(related, 'c', 2), {
    variant: 'a', page: 2, file: '2a.jpg'
  });
  assert.deepEqual(getNextVariantPage(related, 'a', 2), {
    variant: 'c', page: 2, file: '2c.jpg'
  });
});

test('peek keeps exact-page semantics for a configured target', () => {
  assert.equal(getNextVariantPage({
    ...episode,
    peekRelations: { a: 'b' }
  }, 'a', 2), null);
});

test('special variants are naturally ordered by their numeric suffix', () => {
  const specialEpisode = {
    variants: {
      b_sp10: [{ page: 1, file: 'sp10.jpg' }],
      b_sp2: [{ page: 1, file: 'sp2.jpg' }],
      b: [{ page: 1, file: 'base.jpg' }]
    }
  };
  assert.deepEqual(getNextVariantPage(specialEpisode, 'b', 1), {
    variant: 'b_sp2', page: 1, file: 'sp2.jpg'
  });
});

test('invalid and self-referential configured targets fall back to the ordered next variant', () => {
  assert.equal(getNextVariantPage({ ...episode, peekRelations: { a: 'missing' } }, 'a', 1).variant, 'b');
  assert.equal(getNextVariantPage({ ...episode, peekRelations: { a: 'a' } }, 'a', 1).variant, 'b');
});

test('an explicit null Peek relation disables the automatic next variant', () => {
  assert.equal(getNextVariantPage({ ...episode, peekRelations: { a: null } }, 'a', 1), null);
  assert.equal(getNextVariantPage({ ...episode, peekRelations: {} }, 'a', 1).variant, 'b');
});
