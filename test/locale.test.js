import assert from 'node:assert/strict';
import test from 'node:test';
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
