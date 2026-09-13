import { createApp } from 'vue';
import { installTheme } from './theme.js';
import '@varlet/ui/es/style';
import VariantsApp from './VariantsApp.vue';
import { installVarlet } from './install-varlet.js';
import { locale } from '../../public/i18n.js';
import './style.css';

installTheme();
installVarlet(createApp(VariantsApp), locale).mount('#app');
