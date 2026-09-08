import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnsavedEdits } from '../public/unsaved-edits.js';
import { t } from '../public/i18n.js';

test('unchanged editors leave without a dialog', async () => {
  const edits = createUnsavedEdits({ snapshot: () => 'same', confirm: () => { throw Error('Unexpected prompt'); } });
  edits.markSaved();
  assert.equal(await edits.permitLeave(), true);
});

test('dirty editors save, discard, stay, and remain on failed saves', async () => {
  for (const action of ['confirm', 'cancel', 'close']) {
    for (const success of [true, false]) {
      let content = 'initial';
      let saves = 0;
      const edits = createUnsavedEdits({ snapshot: () => content, confirm: async () => action, save: async () => { saves++; return success; } });
      edits.markSaved();
      content = 'edited';
      assert.equal(await edits.permitLeave(), action === 'cancel' || (action === 'confirm' && success));
      assert.equal(saves, Number(action === 'confirm'));
      assert.equal(edits.dirty(), !(action === 'confirm' && success));
    }
  }
});

test('native dialogs and leave prompts have translations in every supported language', () => {
  for (const language of ['en', 'ja', 'zh-CN', 'zh-TW']) {
    for (const key of ['unsavedChanges', 'saveBeforeLeaving', 'discardChanges', 'nativeChooseLibrary', 'nativeChooseFolder', 'nativeSaveLocationFailed', 'nativeLocationUnavailable', 'nativeStartupFailed', 'nativeWindowInactive']) {
      assert.notEqual(t(key, {}, language), key);
    }
  }
  assert.equal(t('nativeChooseFolder', {}, 'en'), 'Select folder');
  assert.equal(t('nativeChooseFolder', {}, 'zh-TW'), '選擇此資料夾');
});

test('repeated back clicks cannot start multiple confirmation or save operations', async () => {
  let content = 'before';
  let resolveConfirmation;
  let saves = 0;
  const edits = createUnsavedEdits({ snapshot: () => content, confirm: () => new Promise(resolve => { resolveConfirmation = resolve; }), save: async () => { saves++; return true; } });
  edits.markSaved();
  content = 'after';
  const first = edits.permitLeave();
  assert.equal(await edits.permitLeave(), false);
  resolveConfirmation('confirm');
  assert.equal(await first, true);
  assert.equal(saves, 1);
});
