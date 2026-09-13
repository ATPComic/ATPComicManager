import test from 'node:test';
import assert from 'node:assert/strict';
import { themePalette, themePresets, hsl } from '../public/theme-palette.js';
import { contrast, oklch } from '../scripts/check-theme.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { output, verifyThemePresets } from '../scripts/generate-themes.mjs';

test('theme verification accepts LF and CRLF while rejecting changed palettes', () => {
  for (const source of [output, output.replace(/\n/g, '\r\n')]) {
    assert.doesNotThrow(() => verifyThemePresets(source));
    assert.throws(() => verifyThemePresets(source.replace(themePresets.green.primary, '#000000')), /out of date/);
  }
});

test('MD3 presets are reproducible with the pinned official generator', async () => {
  await promisify(execFile)(process.execPath, ['scripts/generate-themes.mjs', '--check']);
});

test('theme text pairs meet WCAG AA and accents retain non-text contrast', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21);
  for (const [id, palette] of Object.entries(themePresets)) {
    for (const role of ['primary', 'primary-container', 'info', 'info-container']) {
      assert.ok(contrast(palette[role], palette[`on-${role}`]) >= 4.5, `${id}: ${role}`);
    }
    assert.ok(contrast(palette.primary, '#303238') >= 4.5);
  }
  assert.ok(contrast(themePalette.primary, '#303238') >= 4.5);
  assert.ok(oklch(themePalette.primary).C < oklch('#79e6bf').C);
  assert.ok(oklch(themePalette.primary).L < oklch('#79e6bf').L);
  assert.equal(hsl('#ffffff'), '0, 0%, 100%');
});
