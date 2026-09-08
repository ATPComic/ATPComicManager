import assert from 'node:assert/strict';
import test from 'node:test';
import { applyVariantAssignments } from '../src/model/variant-assignments.js';

function scan(names, assignments = {version: 3, episodes: {}}, markers = []) {
  const library = {episodes: {'20260101': {files: names.map(name => typeof name === 'string' ? {name} : name)}}, warnings: []};
  applyVariantAssignments(library, assignments, markers);
  return library.episodes['20260101'];
}

test('automatic assignment accepts suffixes while keeping exact filename tokens', () => {
  const episode = scan(['20260101_title_a1_x.png', '20260101_b2_extra.png']);
  assert.deepEqual(episode.variants, {a:[1],b:[2],c:[]});
  assert.equal(episode.files[0].assignmentToken, 'a1_x');
  assert.equal(episode.files[1].assignmentToken, 'b2_extra');
});

test('the shortest redundant suffix wins independently of input order', () => {
  const names = ['20260101_a1_long_suffix.png', '20260101_a1_x.png', '20260101_title_a1.png'];
  for (const inputs of [names, [...names].reverse(), names.slice(0, 2)]) {
    const episode = scan(inputs);
    const selected = episode.files.filter(file => file.assignments.length);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].name, inputs.length === 3 ? names[2] : names[1]);
    assert.equal(episode.files.length, inputs.length);
  }
});

test('month-flat priority precedes automatic suffix length', () => {
  const episode = scan([
    {name:'20260101_a1.png',sourceLayout:'folder'},
    {name:'20260101_title_a1_extra.png',sourceLayout:'month-flat'}
  ]);
  assert.equal(episode.files.find(file => file.assignments.length).sourceLayout, 'month-flat');
});

test('manual assignments and deliberately empty manual episodes remain authoritative', () => {
  for (const variants of [{b:['a1_x']}, {a:[],b:[],c:[]}]) {
    const episode = scan(['20260101_a1.png','20260101_a1_x.png'], {version:3,episodes:{'20260101':variants}});
    assert.deepEqual(episode.files.find(file => file.assignmentToken === 'a1').assignments, []);
    assert.deepEqual(episode.files.find(file => file.assignmentToken === 'a1_x').assignments, variants.b.length ? [{variant:'b',pageNumber:1}] : []);
  }
});

test('configured identity markers and numeric-only filenames are not automatically assigned', () => {
  const episode = scan(['20260101_clean_a1_x.png','20260101_01_x.png'], undefined, ['clean']);
  assert.ok(episode.files.every(file => file.assignments.length === 0));
});
