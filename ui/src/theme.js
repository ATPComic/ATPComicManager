import { StyleProvider, Themes } from '@varlet/ui';
import { themePresets, hsl } from '../../public/theme-palette.js';
import { ref } from 'vue';

const key = 'comic-manager.theme';
export const selectedTheme = ref('green');
const normalize = value => Object.hasOwn(themePresets, value) ? value : 'green';
export function selectTheme(value) {
  selectedTheme.value = normalize(value);
  try { localStorage.setItem(key, selectedTheme.value); } catch { /* Storage can be unavailable in private sessions. */ }
  applyTheme();
}

export function installTheme() {
  try { selectedTheme.value = normalize(localStorage.getItem(key)); } catch { selectedTheme.value = 'green'; }
  applyTheme();
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      selectedTheme.value = normalize(event.newValue);
      applyTheme();
    }
  });
}

function applyTheme() {
  StyleProvider({
    ...Themes.md3Dark,
    ...Object.fromEntries(Object.entries(themePresets[selectedTheme.value]).flatMap(([role, color]) => [
      [`--color-${role}`, color], [`--hsl-${role}`, hsl(color)]
    ])),
    '--color-body': 'var(--app-bg)',
    '--color-text': 'var(--text)',
    '--color-surface-container': 'var(--surface)',
    '--color-surface-container-low': 'var(--surface)',
    '--color-surface-container-high': 'var(--surface-high)',
    '--color-surface-container-highest': 'var(--surface-highest)',
    '--color-outline': 'var(--outline)',
    '--color-on-surface-variant': 'var(--muted)',
    '--button-default-color': 'var(--surface-highest)',
    '--button-default-filled-color': 'var(--surface-highest)'
  });
}
