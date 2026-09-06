import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const scriptPath = new URL('../neeview/Scripts/shared/comic-archive-core.nvjs', import.meta.url);
const script = await readFile(scriptPath, 'utf8');
const bookLoadedScript = await readFile(
  new URL('../neeview/Scripts/OnBookLoaded.nvjs', import.meta.url),
  'utf8'
);

function normalize(value) {
  return path.win32.normalize(String(value)).toLowerCase();
}

function createRuntime() {
  const index = JSON.stringify({
    version: 1,
    episodes: [{
      episode: '001',
      variants: {
        a: [
          { page: 1, file: '001/20240105_1a.jpg' },
          { page: 2, file: '001/20240105_2a.jpg' }
        ],
        b: [
          { page: 1, file: '001/20240105_1b.jpg' },
          { page: 2, file: '001/20240105_2b.jpg' }
        ]
      }
    }]
  });
  const files = new Map([
    [normalize('C:\\Reading\\Theme\\.theme-index.json'), index],
    [normalize('C:\\Reading\\Theme\\001\\20240105_1a.jpg'), ''],
    [normalize('C:\\Reading\\Theme\\001\\20240105_1b.jpg'), ''],
    [normalize('C:\\Reading\\Theme\\001\\20240105_2a.jpg'), ''],
    [normalize('C:\\Reading\\Theme\\001\\20240105_2b.jpg'), '']
  ]);
  const layers = [];
  const context = {
    System: {
      IO: {
        Path: {
          Combine: path.win32.join,
          GetDirectoryName: path.win32.dirname,
          GetRelativePath: path.win32.relative
        },
        File: {
          Exists: value => files.has(normalize(value)),
          ReadAllText: value => files.get(normalize(value)),
          GetLastWriteTimeUtc: () => ({ Ticks: 1 })
        },
        Directory: { Exists: () => false }
      }
    },
    nv: {
      Values: {},
      Book: {
        Path: 'C:\\Reading\\Theme\\001',
        ViewPages: [{ RawPath: 'C:\\Reading\\Theme\\001\\20240105_1a.jpg' }],
        Pages: [
          { Path: 'C:\\Reading\\Theme\\001\\20240105_1a.jpg' },
          { Path: 'C:\\Reading\\Theme\\001\\20240105_1b.jpg' },
          { Path: 'C:\\Reading\\Theme\\001\\20240105_2a.jpg' },
          { Path: 'C:\\Reading\\Theme\\001\\20240105_2b.jpg' }
        ]
      },
      Command: {
        JumpPage: { Execute() {} },
        LoadAs: { Execute() {} }
      },
      // This is only the UI panel accessor and must not be used for layers.
      Effect: {},
      ImageEffect: {
        IsEnabled: false,
        Layers: layers,
        CreateNew() {
          const layer = {
            EffectType: 'None',
            IsEnabled: false,
            Effect: { ImagePath: '', Radius: 0, Feather: 0 },
            Remove() {
              const index = layers.indexOf(layer);
              if (index >= 0) layers.splice(index, 1);
            }
          };
          layers.push(layer);
          return layer;
        }
      },
      ShowMessage() {}
    }
  };

  vm.runInNewContext(script, context, { filename: 'comic-archive-core.nvjs' });
  return { context, layers };
}

test('variant peek creates and enables a Peek layer through nv.ImageEffect', () => {
  const { context, layers } = createRuntime();

  assert.equal(context.syncVariantPeek(), true);
  assert.equal(context.nv.ImageEffect.IsEnabled, true);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].EffectType, 'Peek');
  assert.equal(layers[0].IsEnabled, true);
  assert.equal(layers[0].Effect.ImagePath, 'C:\\Reading\\Theme\\001\\20240105_1b.jpg');
  assert.equal(layers[0].Effect.Radius, context.variantPeekSettings.radius);
  assert.equal(layers[0].Effect.Feather, context.variantPeekSettings.feather);
});

test('variant peek clamps configured radius and feather before applying them', () => {
  const { context, layers } = createRuntime();
  context.variantPeekSettings.radius = 2;
  context.variantPeekSettings.feather = -4;

  assert.equal(context.syncVariantPeek(), true);
  assert.equal(layers[0].Effect.Radius, 1);
  assert.equal(layers[0].Effect.Feather, 0);
});

test('variant peek defaults to enabled but honors an existing disabled layer', () => {
  const firstRun = createRuntime();
  assert.equal(firstRun.context.getPeekEnabled(), true);

  const existingLayerRun = createRuntime();
  existingLayerRun.layers.push({ EffectType: 'Peek', IsEnabled: false, Effect: { ImagePath: '' } });
  assert.equal(existingLayerRun.context.getPeekEnabled(), false);
});

test('variant peek removes duplicate Peek layers and keeps the active one', () => {
  const { context, layers } = createRuntime();
  const staleLayer = context.nv.ImageEffect.CreateNew();
  staleLayer.EffectType = 'Peek';
  staleLayer.Effect.ImagePath = 'C:\\Reading\\stale.jpg';

  const activeLayer = context.nv.ImageEffect.CreateNew();
  activeLayer.EffectType = 'Peek';
  activeLayer.IsEnabled = true;
  activeLayer.Effect.ImagePath = 'C:\\Reading\\active.jpg';

  const unrelatedLayer = context.nv.ImageEffect.CreateNew();
  unrelatedLayer.EffectType = 'Blur';

  assert.equal(context.syncVariantPeek(), true);
  assert.equal(layers.filter(layer => layer.EffectType === 'Peek').length, 1);
  assert.equal(layers.includes(activeLayer), true);
  assert.equal(layers.includes(staleLayer), false);
  assert.equal(layers.includes(unrelatedLayer), true);
  assert.equal(activeLayer.Effect.ImagePath, 'C:\\Reading\\Theme\\001\\20240105_1b.jpg');
});

test('variant peek migrates the stale disabled state left by the old accessor bug', () => {
  const { context } = createRuntime();
  context.nv.Values.ComicArchiveNeeViewStore = {
    themeIndexCache: {},
    peekEnabled: false
  };

  assert.equal(context.getPeekEnabled(), true);
  assert.equal(context.nv.Values.ComicArchiveNeeViewStore.peekStateVersion, 1);
});

test('PageNext fills the destination page Peek path before JumpPage executes', () => {
  const { context, layers } = createRuntime();
  let pathAtJump = null;
  context.nv.Command.JumpPage.Execute = () => {
    pathAtJump = layers[0]?.Effect.ImagePath;
  };

  assert.equal(context.runPageNext(), true);
  assert.equal(pathAtJump, 'C:\\Reading\\Theme\\001\\20240105_2b.jpg');
});

test('book-loaded hook writes PageEndAction through the documented config accessor', () => {
  assert.match(bookLoadedScript, /nv\.Config\.Book\.PageEndAction\s*=\s*'None'/);
  assert.doesNotMatch(bookLoadedScript, /nv\.Book\.Config\.PageEndAction/);
});
