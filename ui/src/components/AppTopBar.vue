<script setup>
import { ref } from 'vue';
import {
  mdiCodeJson,
  mdiExportVariant,
  mdiFileTreeOutline,
  mdiTagMultipleOutline,
  mdiTuneVariant
} from '../icons.js';
import { t } from '../../../public/i18n.js';
import LanguageMenu from './LanguageMenu.vue';
import LibraryLocationControl from './LibraryLocationControl.vue';
import MdiIcon from './MdiIcon.vue';

defineProps({
  busyAction: { type: String, default: null },
  issueCount: { type: Number, default: 0 },
  libraryLocation: { type: String, default: '' },
  localeOptions: { type: Array, default: () => [] },
  selectedLocale: { type: String, required: true }
});

const emit = defineEmits([
  'change-locale',
  'export-json',
  'export-reading',
  'import-json',
  'issues',
  'recognition',
  'scan',
  'tags',
  'variants'
]);

const exportOpen = ref(false);

function exportAction(name) {
  exportOpen.value = false;
  emit(name);
}
</script>

<template>
  <header class="top-app-bar">
    <div class="brand-block">
      <var-avatar size="26" color="#294a7a" text-color="#d8e2ff">ATP</var-avatar>
      <h1>{{ t('appTitle') }}</h1>
    </div>
    <nav class="top-actions">
      <var-button size="small" text @click="emit('variants')"><MdiIcon :path="mdiTuneVariant" />{{ t('manualVariants') }}</var-button>
      <var-button size="small" text @click="emit('tags')"><MdiIcon :path="mdiTagMultipleOutline" />{{ t('tags') }}</var-button>
      <LibraryLocationControl :busy-action="busyAction" :issue-count="issueCount" :library-location="libraryLocation" @scan="emit('scan')" @issues="emit('issues')" @recognition="emit('recognition')" @import-json="emit('import-json')" />
      <var-menu v-model:show="exportOpen" placement="bottom-end" :offset-y="8" popover-class="top-export-popover">
        <var-button size="small" type="primary" :loading="busyAction?.startsWith('export')" :disabled="!!busyAction" aria-haspopup="menu">
          <MdiIcon :path="mdiExportVariant" />{{ t('exportMenu') }}
        </var-button>
        <template #menu>
          <div class="top-export-menu" role="menu">
            <var-button block text role="menuitem" @click="exportAction('export-json')">
              <MdiIcon :path="mdiCodeJson" />
              <span><strong>{{ t('exportJson') }}</strong><small>{{ t('exportJsonSupporting') }}</small></span>
            </var-button>
            <var-button block text role="menuitem" @click="exportAction('export-reading')">
              <MdiIcon :path="mdiFileTreeOutline" />
              <span><strong>{{ t('exportReading') }}</strong><small>{{ t('exportReadingSupporting') }}</small></span>
            </var-button>
          </div>
        </template>
      </var-menu>
      <LanguageMenu
        :model-value="selectedLocale"
        :options="localeOptions"
        :label="t('language')"
        @change="emit('change-locale', $event)"
      />
    </nav>
  </header>
</template>
