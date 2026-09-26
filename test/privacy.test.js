import test from 'node:test';
import assert from 'node:assert/strict';
import { privacyContent, privacyUpdated } from '../public/locales/privacy.js';
import { t } from '../public/i18n.js';
import { readFile } from 'node:fs/promises';

test('privacy notice covers all supported languages and includes the revision date', () => {
  assert.match(privacyUpdated, /^\d{4}-\d{2}-\d{2}$/);
  for (const language of ['en', 'ja', 'zh-CN', 'zh-TW']) {
    assert.ok(privacyContent[language].summary);
    assert.equal(privacyContent[language].sections.length, 5);
    assert.ok(privacyContent[language].sections.every(section => section.length === 2 && section.every(Boolean)));
    assert.match(privacyContent[language].sections[2][1], /\[.+\]\(github\)/);
    assert.match(privacyContent[language].sections[4][1], /\[GitHub Issues\]\(issues\)/);
    for (const key of ['about', 'privacy', 'privacyUpdated', 'importChooseFile', 'importIndexing']) assert.notEqual(t(key, {}, language), key);
  }
});

test('page entries share the brand theme and settings items share a style', async () => {
  for (const file of ['main.js', 'privacy-main.js', 'tags-main.js', 'variants-main.js', 'warnings-main.js']) {
    const source = await readFile(new URL(`../ui/src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /mountApp\(/);
    assert.doesNotMatch(source, /Themes.md3Dark/);
  }
  const bootstrap = await readFile(new URL('../ui/src/app/bootstrap.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /installTheme\(\)/);
  assert.doesNotMatch(bootstrap, /Themes.md3Dark/);
  const about = await readFile(new URL('../ui/src/components/SettingsMenu.vue', import.meta.url), 'utf8');
  assert.equal((about.match(/<AppMenuItem /g) ?? []).length, 2);
  assert.match(about, /class="about-links"/);
  assert.match(about, /href="https:\/\/github.com\/ATPComic\/ATPComicManager"/);
  assert.doesNotMatch(about, /<AppMenuItem[^>]+privacy/);
});

test('cache entry is above About in Settings, not in library controls', async () => {
  for (const file of ['PagesLibraryControl.vue', 'LibraryLocationControl.vue']) {
    const source = await readFile(new URL(`../ui/src/components/${file}`, import.meta.url), 'utf8');
    assert.ok(!source.includes('PreviewCacheControl'));
  }
  const about = await readFile(new URL('../ui/src/components/SettingsMenu.vue', import.meta.url), 'utf8');
  assert.ok(about.includes('PreviewCacheControl'));
  assert.ok(about.includes("appPath('/privacy/')"));
  assert.ok(about.indexOf(':label="text(\'previewCache\')"') < about.indexOf('class="settings-about"'));
  assert.match(about, /mdiInformationOutline/);
});
