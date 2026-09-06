import { createApp } from 'vue';
import { StyleProvider, Themes } from '@varlet/ui';
import '@varlet/ui/es/style';
import TagsApp from './TagsApp.vue';
import { installVarlet } from './install-varlet.js';
import { locale } from '../../public/i18n.js';
import './style.css';

StyleProvider(Themes.md3Dark);
installVarlet(createApp(TagsApp), locale).mount('#app');
