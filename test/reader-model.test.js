import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEpisodeReaderModel,
  findNearestPageEntry,
  findPageEntry,
  getAdjacentEntry,
  getImageUrl,
  getPageSideDirection,
  getPeekTargetVariant,
  getSequencePosition,
  getThumbnailUrl,
  getNextVariant,
  getWheelIntent,
  normalizePeekSettings,
  resolvePeekTarget,
  setReaderAssetUrlResolver
} from '../public/reader-model.js';

const episode = {
  files: [
    { name: '20240105_a1.jpg' },
    { name: '20240105_a3.jpg' },
    { name: '20240105_b1.jpg' },
    { name: '20240105_b2.jpg' },
    { name: 'notes.txt' }
  ]
};

test('reader model groups variants and retains API file indexes', () => {
  const model = createEpisodeReaderModel(episode);
  assert.deepEqual(model.variantNames, ['a', 'b']);
  assert.equal(findPageEntry(model, 'b', 1).index, 2);
  assert.equal(getNextVariant(model, 'a'), 'b');
  assert.equal(getNextVariant(model, 'b'), null);
});

test('thumbnail URLs can carry a stable source identity across rescans', () => {
  assert.equal(
    getThumbnailUrl('20250401', 2, '1_x'),
    '/api/thumbnail?episodeId=20250401&index=2&file=1_x'
  );
});

test('reader asset resolver supplies native image and thumbnail URLs', () => {
  setReaderAssetUrlResolver((kind, episodeId, index) => `native://${kind}/${episodeId}/${index}`);
  try {
    assert.equal(getImageUrl('20250401', 2), 'native://image/20250401/2');
    assert.equal(getThumbnailUrl('20250401', 2), 'native://thumbnail/20250401/2');
  } finally {
    setReaderAssetUrlResolver();
  }
});

test('reader exposes one source image in every assigned variant', () => {
  const model = createEpisodeReaderModel({
    files: [{
      name: '20250401_info_1.jpg',
      assignments: [
        { variant: 'a', pageNumber: 1 },
        { variant: 'd', pageNumber: 3 }
      ]
    }]
  });
  assert.deepEqual(model.variantNames, ['a', 'd']);
  assert.equal(findPageEntry(model, 'a', 1).index, 0);
  assert.equal(findPageEntry(model, 'd', 3).index, 0);
});

test('sparse special variants inherit base pages and override only matching pages', () => {
  const model = createEpisodeReaderModel({
    files: [
      { name: '20250401_b1.jpg' },
      { name: '20250401_b2.jpg' },
      { name: '20250401_b3.jpg' },
      { name: '20250401_b2_sp1.jpg', assignments: [{ variant: 'b_sp1', pageNumber: 2 }] },
      { name: '20250401_b2_sp2.jpg', assignments: [{ variant: 'b_sp2', pageNumber: 2 }] }
    ]
  });

  assert.deepEqual(model.variantNames, ['b', 'b_sp1', 'b_sp2']);
  assert.equal(findPageEntry(model, 'b_sp1', 1).index, 0);
  assert.equal(findPageEntry(model, 'b_sp1', 1).inheritedFrom, 'b');
  assert.equal(findPageEntry(model, 'b_sp1', 2).index, 3);
  assert.equal(findPageEntry(model, 'b_sp1', 2).inherited, undefined);
  assert.equal(findPageEntry(model, 'b_sp1', 3).index, 2);
  assert.equal(findPageEntry(model, 'b_sp2', 2).index, 4);
});

test('special variant names use numeric ordering', () => {
  const model = createEpisodeReaderModel({
    files: [
      { name: '20250401_b1.jpg' },
      { name: '20250401_b1_sp10.jpg', assignments: [{ variant: 'b_sp10', pageNumber: 1 }] },
      { name: '20250401_b1_sp2.jpg', assignments: [{ variant: 'b_sp2', pageNumber: 1 }] },
      { name: '20250401_c1.jpg' }
    ]
  });
  assert.deepEqual(model.variantNames, ['b', 'b_sp2', 'b_sp10', 'c']);
});

test('peek target priority is temporary, persisted, then default without recursively following cycles', () => {
  const model = createEpisodeReaderModel({
    peekRelations: { c: 'd', d: 'c' },
    files: ['a', 'b', 'c', 'd'].map((variant) => ({
      name: `20250401_${variant}1.jpg`,
      assignments: [{ variant, pageNumber: 1 }]
    }))
  });

  assert.equal(getPeekTargetVariant(model, 'a'), 'b');
  assert.equal(getPeekTargetVariant(model, 'd'), 'c');
  assert.equal(getPeekTargetVariant(model, 'd', 'b'), 'b');
  assert.equal(getPeekTargetVariant(model, 'd', 'missing'), 'c');
  assert.equal(getPeekTargetVariant(model, 'c'), 'd');
  assert.equal(resolvePeekTarget(model, 'd', 1).entry.index, 2);
});

test('a valid configured Peek target with no matching page does not fall through', () => {
  const model = createEpisodeReaderModel({
    peekRelations: { a: 'b' },
    files: [
      { name: '20250401_a2.jpg' },
      { name: '20250401_b1.jpg' },
      { name: '20250401_c2.jpg' }
    ]
  });
  assert.deepEqual(resolvePeekTarget(model, 'a', 2), { variant: 'b', entry: null });
});

test('persisted and temporary null Peek targets explicitly disable fallback', () => {
  const disabled = createEpisodeReaderModel({
    peekRelations: { a: null },
    files: [
      { name: '20250401_a1.jpg' },
      { name: '20250401_b1.jpg' },
      { name: '20250401_c1.jpg' }
    ]
  });
  assert.equal(Object.hasOwn(disabled.peekRelations, 'a'), true);
  assert.equal(disabled.peekRelations.a, null);
  assert.equal(getPeekTargetVariant(disabled, 'a'), null);
  assert.deepEqual(resolvePeekTarget(disabled, 'a', 1), { variant: null, entry: null });

  const configured = createEpisodeReaderModel({
    peekRelations: { a: 'b' },
    files: [
      { name: '20250401_a1.jpg' },
      { name: '20250401_b1.jpg' },
      { name: '20250401_c1.jpg' }
    ]
  });
  assert.equal(getPeekTargetVariant(configured, 'a', undefined), 'b');
  assert.equal(getPeekTargetVariant(configured, 'a', null), null);
  assert.equal(getPeekTargetVariant(configured, 'a', 'c'), 'c');
});

test('special variants are never inferred directly from source filename suffixes', () => {
  const model = createEpisodeReaderModel({ files: [{ name: '20250401_b2_sp1.jpg' }] });
  assert.deepEqual(model.variantNames, []);
});

test('reader reports the episode position inside a collection', () => {
  assert.deepEqual(getSequencePosition(['ep-a', 'ep-b', 'ep-c'], 'ep-b'), { index: 1, current: 2, total: 3 });
  assert.deepEqual(getSequencePosition([], 'ep-b'), { index: -1, current: 0, total: 0 });
});

test('reader navigation stays inside a variant and can choose nearest page', () => {
  const model = createEpisodeReaderModel(episode);
  assert.equal(getAdjacentEntry(model, 'a', 1, 1).page, 3);
  assert.equal(getAdjacentEntry(model, 'a', 3, 1), null);
  assert.equal(findNearestPageEntry(model, 'b', 3).page, 2);
});

test('wheel defaults to paging and only zooms with a control modifier', () => {
  assert.deepEqual(getWheelIntent({ deltaX: 0, deltaY: 120, ctrlKey: false, metaKey: false }), { mode: 'page', delta: 120 });
  assert.deepEqual(getWheelIntent({ deltaX: 0, deltaY: -40, ctrlKey: true, metaKey: false }), { mode: 'zoom', delta: -40 });
});

test('reader side paging only targets visible black margins', () => {
  const viewport = { left: 0, right: 1000 };
  assert.equal(getPageSideDirection(viewport, { left: 200, right: 800 }, 100), -1);
  assert.equal(getPageSideDirection(viewport, { left: 200, right: 800 }, 900), 1);
  assert.equal(getPageSideDirection(viewport, { left: 200, right: 800 }, 500), 0);
  assert.equal(getPageSideDirection(viewport, { left: -100, right: 1100 }, 50), 0);
});

test('peek settings have stable defaults and safe bounds', () => {
  assert.deepEqual(normalizePeekSettings(), { radius: 112, feather: 14, animationSpeed: 100 });
  assert.deepEqual(normalizePeekSettings({ radius: 160.4, feather: 28.2, animationSpeed: 175 }), { radius: 160, feather: 28, animationSpeed: 175 });
  assert.deepEqual(normalizePeekSettings({ radius: 10, feather: 80, animationSpeed: 5 }), { radius: 24, feather: 24, animationSpeed: 25 });
  assert.deepEqual(normalizePeekSettings({ radius: 9999, feather: -5, animationSpeed: 900 }), { radius: 600, feather: 0, animationSpeed: 300 });
});
