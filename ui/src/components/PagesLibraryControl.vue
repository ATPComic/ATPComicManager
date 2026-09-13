<script setup>
import { ref, shallowRef } from 'vue';
import { Snackbar } from '@varlet/ui';
import { importPagesLibrary } from '../api.js';
import { t } from '../../../public/i18n.js';
import { mdiFileImportOutline, mdiFolderOpenOutline, mdiCodeJson } from '../icons.js';
import MdiIcon from './MdiIcon.vue';
import { appPath } from '../navigation.js';
import { authorizePagesDirectory } from '../pages/assets.js';

const emit = defineEmits(['imported']);
const show = ref(false);
const catalog = ref(null);
const directory = shallowRef(null);
const directorySupported = typeof window.showDirectoryPicker === 'function';
const busy = ref(false);
const progress = ref('');
const catalogInput = ref(null);
async function chooseDirectory() {
  try { directory.value = await window.showDirectoryPicker({ mode: 'read', id: 'atp-library' }); }
  catch (error) { if (error.name !== 'AbortError') Snackbar.error({ content: error.message }); }
}
async function reconnect() {
  try {
    if (await authorizePagesDirectory()) window.location.reload();
    else Snackbar.warning({ content: t('pagesPermissionRequired') });
  } catch (error) { Snackbar.error({ content: error.message }); }
}
async function start() {
  if (!catalog.value || !directory.value || busy.value) return;
  busy.value = true;
  try {
    const result = await importPagesLibrary({ catalog: catalog.value, directory: directory.value }, (done, total) => { progress.value = `${done} / ${total}`; });
    Snackbar[result.missingCount ? 'warning' : 'success']({ content: t(result.missingCount ? 'importJsonWarning' : 'importJsonDone', { count: result.missingCount }) });
    emit('imported');
    show.value = false;
  } catch (error) { Snackbar.error({ content: t(error.message) }); }
  finally { busy.value = false; progress.value = ''; }
}
</script>

<template>
  <var-button size="small" text @click="show = true"><MdiIcon :path="mdiFileImportOutline" />{{ t('pagesImport') }}</var-button>
  <var-dialog v-model:show="show" :title="t('pagesImport')" width="min(520px, calc(100vw - 32px))" :confirm-button="false" :cancel-button="false" :close-on-click-overlay="!busy">
    <div class="pages-import-fields" :aria-busy="busy">
      <p class="import-note">{{ t('pagesImportNote') }}</p>
      <p v-if="!directorySupported" role="status">{{ t('pagesDirectoryUnsupported') }}</p>
      <input ref="catalogInput" class="file-picker" type="file" accept=".json,application/json" :disabled="busy" tabindex="-1" @change="catalog = $event.target.files[0] || catalog">
      <section class="import-selection">
        <div class="selection-label"><MdiIcon :path="mdiCodeJson" /><strong>{{ t('pagesSharedJson') }}</strong></div>
        <span class="selected-name" :title="catalog?.name">{{ catalog?.name || t('importNothingSelected') }}</span>
        <var-button outline :disabled="busy" @click="catalogInput.click()">{{ t('importChooseFile') }}</var-button>
      </section>
      <section class="import-selection">
        <div class="selection-label"><MdiIcon :path="mdiFolderOpenOutline" /><strong>{{ t('libraryLocation') }}</strong></div>
        <span class="selected-name" :title="directory?.name">{{ directory?.name || t('importNothingSelected') }}</span>
        <var-button outline :disabled="busy || !directorySupported" @click="chooseDirectory">{{ t('pagesImageFolder') }}</var-button>
      </section>
      <div class="import-support"><var-button size="small" text :disabled="busy || !directorySupported" @click="reconnect">{{ t('pagesReconnect') }}</var-button><a :href="appPath('/privacy/')" target="_blank" rel="noopener">{{ t('privacy') }}</a></div>
      <p v-if="busy" class="import-progress" role="status" aria-live="polite">{{ progress || t('importIndexing') }}</p>
      <div class="import-actions">
        <var-button text :disabled="busy" @click="show = false">{{ t('cancel') }}</var-button>
        <var-button type="primary" :loading="busy" :disabled="!catalog || !directory || busy" @click="start">{{ t('pagesImport') }}</var-button>
      </div>
    </div>
  </var-dialog>
</template>

<style scoped>
.pages-import-fields { display: grid; gap: 16px; min-width: 0; }
.import-note { margin: 0; line-height: 1.6; }
.file-picker { display: none; }
.import-selection { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; align-items: center; padding: 16px; background: var(--surface); border-radius: 8px; }
.selection-label { display: flex; align-items: center; gap: 8px; min-width: 0; }
.selection-label strong { font-size: 14px; font-weight: 500; }
.selected-name { grid-column: 1; font-size: 13px; opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.import-selection > .var-button { grid-column: 2; grid-row: 1 / 3; }
.import-support, .import-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.import-support { justify-content: space-between; }
.import-support a { color: var(--primary); font-size: 13px; padding: 8px; }
.import-progress { margin: 0; font-variant-numeric: tabular-nums; }
@media (max-width: 420px) { .import-selection > .var-button { grid-row: 3; grid-column: 1 / -1; justify-self: start; } }
</style>
