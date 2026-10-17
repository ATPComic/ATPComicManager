import assert from 'node:assert/strict';
import test from 'node:test';
import { languageOptions, t } from '../public/i18n.js';
import { normalizeSystemLocale, resolveLocale } from '../public/locale.js';

test('system locales normalize English, Japanese, and both Chinese scripts', () => {
  assert.equal(normalizeSystemLocale('en-US'), 'en');
  assert.equal(normalizeSystemLocale('ja-JP'), 'ja');
  assert.equal(normalizeSystemLocale('zh-CN'), 'zh-CN');
  assert.equal(normalizeSystemLocale('zh-Hant-TW'), 'zh-TW');
  assert.equal(normalizeSystemLocale('zh-HK'), 'zh-TW');
});

test('locale resolution honors a stored choice and otherwise follows the system', () => {
  assert.equal(resolveLocale({ storedLocale: 'ja', systemLocales: ['zh-CN'] }), 'ja');
  assert.equal(resolveLocale({ systemLocales: ['fr-FR', 'zh-TW'] }), 'zh-TW');
});

test('unsupported system languages fall back to English', () => {
  assert.equal(resolveLocale({ systemLocales: ['fr-FR', 'de-DE'] }), 'en');
  assert.equal(resolveLocale(), 'en');
});

test('reader mode settings label is translated in every supported locale', () => {
  assert.deepEqual(
    ['zh-CN', 'zh-TW', 'en', 'ja'].map((language) => t('readerMode', {}, language)),
    ['阅读模式', '閱讀模式', 'Reading mode', '表示モード']
  );
});

test('language names are autonyms and never translated by the active locale', () => {
  assert.deepEqual(languageOptions, [
    { label: 'English', value: 'en' },
    { label: '日本語', value: 'ja' },
    { label: '中文（简体）', value: 'zh-CN' },
    { label: '中文（繁體）', value: 'zh-TW' }
  ]);
  // No dictionary entry may redefine a language name; the value is the key.
  const languageKeys = ['languageEnglish', 'languageJapanese', 'languageChineseSimplified', 'languageChineseTraditional'];
  for (const language of ['zh-CN', 'zh-TW', 'en', 'ja']) {
    for (const key of languageKeys) {
      assert.equal(t(key, {}, language), key);
    }
  }
});
