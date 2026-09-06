import { createApp } from 'vue';
import { StyleProvider, Themes } from '@varlet/ui';
import '@varlet/ui/es/style';
import VariantsApp from './VariantsApp.vue';
import { installVarlet } from './install-varlet.js';
import { locale } from '../../public/i18n.js';
import './style.css';

StyleProvider(Themes.md3Dark);
installVarlet(createApp(VariantsApp), locale).mount('#app');
