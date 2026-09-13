import { createApp } from 'vue';
import { installTheme } from './theme.js';
import '@varlet/ui/es/style';
import PrivacyApp from './PrivacyApp.vue';
import { installVarlet } from './install-varlet.js';
import { locale } from '../../public/i18n.js';
import './style.css';

installTheme();
installVarlet(createApp(PrivacyApp), locale).mount('#app');
