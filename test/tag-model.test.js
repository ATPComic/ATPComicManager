import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectTagBranchIds,
  findTagDefinitionPath,
  flattenTagDefinitions,
  getOrderedTagEntries,
  migrateTagMap,
  relocateTagDefinition,
  splitLeadingEmoji
} from '../public/tag-model.js';

test('tag migration follows value renames and removes deleted values and categories', () => {
  const categories = [{ id: 'people', name: '人物', values: [{ id: 'Alicia', name: 'Alicia', emoji: '👩' }, { id: 'Bob', name: 'Bob', emoji: '' }] }];
  const renames = { people: { Alice: 'Alicia' } };
  assert.deepEqual(migrateTagMap({ people: ['Alice', 'Bob', 'Deleted'], removed: ['Value'] }, categories, renames), {
    people: ['Alicia', 'Bob']
  });
});

test('leading emoji is split from legacy tag names during migration', () => {
  assert.deepEqual(splitLeadingEmoji('🎨 Style'), { emoji: '🎨', name: 'Style' });
  assert.deepEqual(splitLeadingEmoji('🧑‍🎨 Artist'), { emoji: '🧑‍🎨', name: 'Artist' });
  assert.deepEqual(splitLeadingEmoji('🎨'), { emoji: '🎨', name: '' });
  assert.deepEqual(splitLeadingEmoji('Plain'), { emoji: '', name: 'Plain' });
  assert.deepEqual(
    migrateTagMap({ style: ['🖋️ Ink'] }, [{ id: 'style', values: [{ id: '🖋️ Ink', name: 'Ink', emoji: '🖋️' }] }]),
    { style: ['🖋️ Ink'] }
  );
});

test('emoji-only tag aliases migrate to stable ids', () => {
  assert.deepEqual(
    migrateTagMap({ mood: ['🌙'] }, [{ id: 'mood', name: '', emoji: '🎭', values: [{ id: 'night', name: '', emoji: '🌙' }] }]),
    { mood: ['night'] }
  );
});

test('recursive tags expose paths and descendant branches at any depth', () => {
  const values = [{
    id: 'characters', name: 'Characters', emoji: '🎭', values: [{
      id: 'heroes', name: 'Heroes', emoji: '🦸', values: [
        { id: 'alice', name: 'Alice', emoji: '👩', values: [] }
      ]
    }]
  }];
  assert.deepEqual(flattenTagDefinitions(values).map(({ id, depth }) => ({ id, depth })), [
    { id: 'characters', depth: 0 },
    { id: 'heroes', depth: 1 },
    { id: 'alice', depth: 2 }
  ]);
  assert.deepEqual(findTagDefinitionPath(values, 'alice').map((value) => value.id), ['characters', 'heroes', 'alice']);
  assert.deepEqual(collectTagBranchIds(values, 'heroes'), ['heroes', 'alice']);
  assert.deepEqual(
    migrateTagMap({ people: ['👩 Alice'] }, [{ id: 'people', values }]),
    { people: ['alice'] }
  );
});

test('assigned tags follow catalog hierarchy order instead of assignment order', () => {
  const categories = [
    { id: 'style', values: [{ id: 'rendering', name: 'Rendering', values: [{ id: 'ink', name: 'Ink' }] }] },
    { id: 'people', values: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }] }
  ];
  const entries = getOrderedTagEntries({ people: ['bob', 'alice'], style: ['ink', 'rendering'] }, categories);
  assert.deepEqual(entries.map(({ categoryId, valueId }) => ({ categoryId, valueId })), [
    { categoryId: 'style', valueId: 'rendering' },
    { categoryId: 'style', valueId: 'ink' },
    { categoryId: 'people', valueId: 'alice' },
    { categoryId: 'people', valueId: 'bob' }
  ]);
  assert.deepEqual(entries[1].path.map((part) => part.id), ['rendering', 'ink']);
});

test('stable assignments follow a tag moved across macro categories', () => {
  const previousCategories = [{
    id: 'people',
    values: [{ id: 'roles', name: 'Roles', values: [{ id: 'hero', name: 'Hero' }] }]
  }, { id: 'style', values: [] }];
  const categories = [{ id: 'people', values: [{ id: 'roles', name: 'Roles', values: [] }] }, {
    id: 'style',
    values: [{ id: 'hero', name: 'Hero' }]
  }];

  assert.deepEqual(
    migrateTagMap({ people: ['hero'] }, categories, {}, previousCategories),
    { style: ['hero'] }
  );
});

test('tag definitions can be reparented without replacing their stable ids', () => {
  const hero = { id: 'hero', name: 'Hero', values: [] };
  const categories = [{
    id: 'people',
    values: [{ id: 'roles', name: 'Roles', values: [hero] }, { id: 'teams', name: 'Teams', values: [] }]
  }];

  assert.equal(relocateTagDefinition(
    categories,
    { categoryId: 'people', nodeId: 'hero' },
    { categoryId: 'people', nodeId: 'teams', placement: 'inside' }
  ), true);
  assert.equal(categories[0].values[1].values[0], hero);
  assert.deepEqual(migrateTagMap({ people: ['hero'] }, categories), { people: ['hero'] });
  assert.equal(relocateTagDefinition(
    categories,
    { categoryId: 'people', nodeId: 'teams' },
    { categoryId: 'people', nodeId: 'hero', placement: 'inside' }
  ), false);
});
