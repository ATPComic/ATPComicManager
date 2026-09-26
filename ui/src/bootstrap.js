import { createApp } from 'vue';
import { installTheme } from './theme.js';
import '@varlet/ui/es/style';
import { installVarlet } from './install-varlet.js';
import { locale } from '../../public/i18n.js';
import './style.css';

// Every HTML entry point shares one bootstrap so theme, locale and component
// registration cannot drift between the main app and the auxiliary pages.
export function mountApp(rootComponent) {
  installTheme();
  return installVarlet(createApp(rootComponent), locale).mount('#app');
}
