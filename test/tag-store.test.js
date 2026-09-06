import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTagState, mergeTagMaps, saveTagState } from '../src/tag-store.js';

test('tag state normalizes categories and persists episode tags', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-tags-'));
  const filePath = path.join(root, 'library.sqlite');
  await saveTagState(filePath, {
    categories: [{ name: '👥 人物', values: ['👩 Alice', '👩 Alice', ' Bob '] }],
    episodeTags: { '20240101': { 'category-1': ['👩 Alice'] } }
  });
  const state = await loadTagState(filePath);
  assert.deepEqual(state.categories, [{
    id: 'category-1',
    name: '人物',
    emoji: '👥',
    values: [
      { id: '👩 Alice', name: 'Alice', emoji: '👩', values: [] },
      { id: 'Bob', name: 'Bob', emoji: '', values: [] }
    ]
  }]);
  assert.deepEqual(state.episodeTags['20240101'], { 'category-1': ['👩 Alice'] });
});

test('tag state migrates leading emoji for macro and child tags', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-tags-emoji-'));
  const filePath = path.join(root, 'library.sqlite');
  await saveTagState(filePath, {
    categories: [{ id: 'style', name: '🎨 Style', values: ['🖋️ Ink'] }],
    episodeTags: { '20240101': { style: ['🖋️ Ink'] } }
  });
  const state = await loadTagState(filePath);
  assert.deepEqual(state.categories[0], {
    id: 'style', name: 'Style', emoji: '🎨', values: [{ id: '🖋️ Ink', name: 'Ink', emoji: '🖋️', values: [] }]
  });
  assert.deepEqual(state.episodeTags['20240101'], { style: ['🖋️ Ink'] });
});

test('tag state persists only canonical category colors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-tags-color-'));
  const filePath = path.join(root, 'library.sqlite');
  const saved = await saveTagState(filePath, {
    categories: [
      { id: 'people', name: 'People', color: '#A1B2C3', values: [] },
      { id: 'style', name: 'Style', color: '#abc', values: [] },
      { id: 'mood', name: 'Mood', color: 'not-a-color', values: [] },
      { id: 'period', name: 'Period', color: ' #112233 ', values: [] }
    ]
  });

  assert.equal(saved.categories[0].color, '#a1b2c3');
  assert.equal(Object.hasOwn(saved.categories[1], 'color'), false);
  assert.equal(Object.hasOwn(saved.categories[2], 'color'), false);
  assert.equal(Object.hasOwn(saved.categories[3], 'color'), false);
  assert.deepEqual(await loadTagState(filePath), saved);
});

test('renaming an emoji tag keeps its stable assignment id', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-tags-rename-'));
  const filePath = path.join(root, 'library.sqlite');
  const initial = await saveTagState(filePath, {
    categories: [{ id: 'style', name: 'Style', emoji: '🎨', values: [{ id: 'ink', name: 'Ink', emoji: '🖋️' }] }],
    episodeTags: { '20240101': { style: ['ink'] } }
  });
  initial.categories[0].values[0].name = 'Line art';
  initial.categories[0].values[0].emoji = '✒️';
  await saveTagState(filePath, initial);
  const state = await loadTagState(filePath);
  assert.deepEqual(state.categories[0].values[0], { id: 'ink', name: 'Line art', emoji: '✒️', values: [] });
  assert.deepEqual(state.episodeTags['20240101'], { style: ['ink'] });
});

test('emoji-only categories and tags keep empty titles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-tags-emoji-only-'));
  const filePath = path.join(root, 'library.sqlite');
  await saveTagState(filePath, {
    categories: [{ id: 'mood', name: '', emoji: '🎭', values: [{ id: 'night', name: '', emoji: '🌙' }] }],
    episodeTags: { '20240101': { mood: ['night'] } }
  });
  const state = await loadTagState(filePath);
  assert.deepEqual(state.categories, [{
    id: 'mood', name: '', emoji: '🎭', values: [{ id: 'night', name: '', emoji: '🌙', values: [] }]
  }]);
  assert.deepEqual(state.episodeTags['20240101'], { mood: ['night'] });
});

test('tag state persists recursive tag trees and upgrades to version 3', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-manager-tags-tree-'));
  const filePath = path.join(root, 'library.sqlite');
  const state = await saveTagState(filePath, {
    version: 2,
    categories: [{
      id: 'people', name: 'People', emoji: '👥', values: [{
        id: 'roles', name: 'Roles', emoji: '🎭', values: [{
          id: 'hero', name: 'Hero', emoji: '🦸', values: []
        }]
      }]
    }],
    episodeTags: { '20240101': { people: ['hero'] } }
  });
  assert.equal(state.version, 3);
  assert.equal(state.categories[0].values[0].values[0].id, 'hero');
  assert.deepEqual((await loadTagState(filePath)).episodeTags['20240101'], { people: ['hero'] });
});

test('tag maps merge values without duplicates', () => {
  assert.deepEqual(mergeTagMaps({ people: ['A'] }, { people: ['A', 'B'], style: ['ink'] }), {
    people: ['A', 'B'], style: ['ink']
  });
});
