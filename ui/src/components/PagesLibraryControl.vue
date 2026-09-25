<script setup>
import { ref, shallowRef, watch } from 'vue';
import { Snackbar } from '@varlet/ui';
import { importPagesLibrary, requestJson } from '../api.js';
import { t } from '../../../public/i18n.js';
import { mdiFolderOpenOutline, mdiCodeJson } from '../icons.js';
import MdiIcon from './MdiIcon.vue';
import { appPath } from '../navigation.js';
import { directoryAccess, restoreDirectoryAccess } from '../pages/access.js';
import { downloadLibraryBackup } from '../pages/backup.js';
import { pagesText } from '../../../public/locales/pages.js';

const props = defineProps({ autoOpen: Boolean });
const emit = defineEmits(['imported', 'recognition']);
const show = ref(false);
const catalog = ref(null);
const directory = shallowRef(null);
const directorySupported = typeof window.showDirectoryPicker === 'function';
const busy = ref(false);
const progress = ref('');
const catalogInput = ref(null);
const confirmReplace = ref(false);
const pendingRoot = shallowRef(null);
const backingUp = ref(false);
watch(() => directoryAccess.value.status, status => { if (props.autoOpen && status === 'empty') show.value = true; }, { immediate: true });
async function chooseDirectory() {
  try { directory.value = await window.showDirectoryPicker({ mode: 'read', id: 'atp-library' }); }
  catch (error) { if (error.name !== 'AbortError') Snackbar.error({ content: error.message }); }
}
async function reconnect() {
  try {
    if (await restoreDirectoryAccess()) emit('imported');
    else Snackbar.warning({ content: t('pagesPermissionRequired') });
  } catch (error) { Snackbar.error({ content: error.message }); }
}
async function sameAsStored(root) {
  const stored = directoryAccess.value.root;
  if (!stored || !root) return false;
  try { return await root.isSameEntry(stored); } catch { return false; }
}
async function start() {
  const root = directory.value || directoryAccess.value.root;
  if (!root || busy.value) return;
  if (directory.value && directoryAccess.value.root && !(await sameAsStored(root))) {
    pendingRoot.value = root;
    show.value = false;
    confirmReplace.value = true;
    return;
  }
  await runImport(root);
}
async function runImport(root) {
  busy.value = true;
  try {
    const result = await importPagesLibrary({ catalog: catalog.value, directory: root }, (done, total) => { progress.value = total ? `${done} / ${total}` : pagesText('scanned', done); });
    Snackbar[result.missingCount ? 'warning' : 'success']({ content: t(result.missingCount ? 'importJsonWarning' : 'importJsonDone', { count: result.missingCount }) });
    emit('imported');
    show.value = false;
  } catch (error) { Snackbar.error({ content: t(error.message) }); show.value = true; }
  finally { busy.value = false; progress.value = ''; }
}
function cancelReplace() {
  confirmReplace.value = false;
  pendingRoot.value = null;
  show.value = true;
}
async function confirmReplaceAndOpen() {
  const root = pendingRoot.value;
  confirmReplace.value = false;
  pendingRoot.value = null;
  if (root) await runImport(root);
}
async function backup() {
  if (backingUp.value) return;
  backingUp.value = true;
  try { await downloadLibraryBackup(); Snackbar.success({ content: t('exportJsonDone') }); }
  catch { Snackbar.error({ content: t('exportFailed') }); }
  finally { backingUp.value = false; }
}
async function scan() {
  busy.value = true;
  try { await requestJson('/api/scan', { method: 'POST' }); emit('imported'); }
  catch (error) { Snackbar.error({ content: t(error.message) }); }
  finally { busy.value = false; }
}
</script>

<template>
  <var-button size="small" text @click="show = true"><MdiIcon :path="mdiFolderOpenOutline" />{{ t('libraryLocation') }}</var-button>
  <var-dialog v-model:show="show" :title="t('libraryLocation')" width="min(520px, calc(100vw - 32px))" :confirm-button="false" :cancel-button="false" :close-on-click-overlay="!busy">
    <div class="pages-import-fields" :aria-busy="busy">
      <p class="import-note">{{ pagesText('note') }}</p>
      <div class="import-actions"><var-button text :disabled="busy || !directoryAccess.root" @click="scan">{{ pagesText('scan') }}</var-button><var-button text :disabled="busy" @click="show = false; emit('recognition')">{{ t('recognitionRules') }}</var-button></div>
      <p v-if="!directorySupported" role="status">{{ t('pagesDirectoryUnsupported') }}</p>
      <input ref="catalogInput" class="file-picker" type="file" accept=".json,application/json" :disabled="busy" tabindex="-1" @change="catalog = $event.target.files[0] || catalog">
      <section class="import-selection">
        <div class="selection-label"><MdiIcon :path="mdiFolderOpenOutline" /><strong>{{ t('libraryLocation') }}</strong></div>
        <span class="selected-name" :title="directory?.name || directoryAccess.root?.name">{{ directory?.name || directoryAccess.root?.name || t('importNothingSelected') }}</span>
        <var-button outline :disabled="busy || !directorySupported" @click="chooseDirectory">{{ t('pagesImageFolder') }}</var-button>
      </section>
      <section class="import-selection">
        <div class="selection-label"><MdiIcon :path="mdiCodeJson" /><strong>{{ pagesText('optional') }}</strong></div>
        <span class="selected-name" :title="catalog?.name">{{ catalog?.name || t('importNothingSelected') }}<var-button v-if="catalog" size="mini" text :disabled="busy" @click="catalog = null; catalogInput.value = ''">{{ t('cancel') }}</var-button></span>
        <var-button outline :disabled="busy" @click="catalogInput.click()">{{ t('importChooseFile') }}</var-button>
      </section>
      <div class="import-support"><var-button size="small" text :disabled="busy || !directorySupported" @click="reconnect">{{ t('pagesReconnect') }}</var-button><a :href="appPath('/privacy/')" target="_blank" rel="noopener">{{ t('privacy') }}</a></div>
      <p v-if="busy" class="import-progress" role="status" aria-live="polite">{{ progress || t('importIndexing') }}</p>
      <div class="import-actions">
        <var-button text :disabled="busy" @click="show = false">{{ t('cancel') }}</var-button>
        <var-button type="primary" :loading="busy" :disabled="(!directory && !directoryAccess.root) || busy" @click="start">{{ pagesText('open') }}</var-button>
      </div>
    </div>
  </var-dialog>
  <var-dialog v-model:show="confirmReplace" :title="t('pagesReselectTitle')" width="min(480px, calc(100vw - 32px))" :confirm-button="false" :cancel-button="false">
    <p class="import-note">{{ t('pagesReselectWarning') }}</p>
    <div class="import-actions">
      <var-button text :disabled="busy" @click="cancelReplace">{{ t('cancel') }}</var-button>
      <var-button text :loading="backingUp" :disabled="busy" @click="backup">{{ t('pagesBackup') }}</var-button>
      <var-button type="primary" :disabled="busy" @click="confirmReplaceAndOpen">{{ t('pagesReselectConfirm') }}</var-button>
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
