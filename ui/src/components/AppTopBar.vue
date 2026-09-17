<script setup>
import { ref } from 'vue';
import appIcon from '../../../design/atp-comic/icon.svg?url';
import {
  mdiCodeJson,
  mdiExportVariant,
  mdiFileTreeOutline,
  mdiTagMultipleOutline,
  mdiTuneVariant
} from '../icons.js';
import { t } from '../../../public/i18n.js';
import SettingsMenu from './SettingsMenu.vue';
import LibraryLocationControl from './LibraryLocationControl.vue';
import MdiIcon from './MdiIcon.vue';
import { isPagesApp } from '../api.js';
import PagesLibraryControl from './PagesLibraryControl.vue';
import AppMenuItem from './AppMenuItem.vue';

defineProps({
  busyAction: { type: String, default: null },
  issueCount: { type: Number, default: 0 },
  libraryLocation: { type: String, default: '' },
  localeOptions: { type: Array, default: () => [] },
  selectedLocale: { type: String, required: true }
});

const emit = defineEmits([
  'change-locale',
  'pages-imported',
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
      <img class="brand-icon" :src="appIcon" width="26" height="26" alt="" draggable="false">
      <h1>{{ t('appTitle') }}</h1>
    </div>
    <nav class="top-actions">
      <PagesLibraryControl v-if="isPagesApp" @imported="emit('pages-imported')" @recognition="emit('recognition')" />
      <LibraryLocationControl v-else :busy-action="busyAction" :issue-count="issueCount" :library-location="libraryLocation" @scan="emit('scan')" @issues="emit('issues')" @recognition="emit('recognition')" @import-json="emit('import-json')" />
      <var-button size="small" text @click="emit('variants')"><MdiIcon :path="mdiTuneVariant" />{{ t('manualVariants') }}</var-button>
      <var-button size="small" text @click="emit('tags')"><MdiIcon :path="mdiTagMultipleOutline" />{{ t('tags') }}</var-button>
      <var-menu v-model:show="exportOpen" placement="bottom-end" :offset-y="8" popover-class="app-menu-popover">
        <var-button text size="small" :loading="busyAction?.startsWith('export')" :disabled="!!busyAction" aria-haspopup="menu">
          <MdiIcon :path="mdiExportVariant" />{{ t('exportMenu') }}
        </var-button>
        <template #menu>
          <div class="top-export-menu" role="menu">
            <AppMenuItem role="menuitem" :icon="mdiCodeJson" :label="t('exportJson')" :description="t('exportJsonSupporting')" @click="exportAction('export-json')" />
            <AppMenuItem v-if="!isPagesApp" role="menuitem" :icon="mdiFileTreeOutline" :label="t('exportReading')" :description="t('exportReadingSupporting')" @click="exportAction('export-reading')" />
          </div>
        </template>
      </var-menu>
      <SettingsMenu
        :model-value="selectedLocale"
        :options="localeOptions"
        @change="emit('change-locale', $event)"
      />
    </nav>
  </header>
</template>
