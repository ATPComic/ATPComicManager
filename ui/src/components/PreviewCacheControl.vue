<script setup>
import { computed, ref } from 'vue';
import { Dialog, Snackbar } from '@varlet/ui';
import { requestJson } from '../services/api.js';
import { t } from '../../../public/i18n.js';
import MdiIcon from './MdiIcon.vue';
import { mdiDeleteOutline } from '../lib/icons.js';
defineProps({ hideTrigger: Boolean });
defineExpose({ open });

const show = ref(false);
const busy = ref(false);
const stats = ref(null);
const error = ref('');
const size = computed(() => {
  const bytes = stats.value?.bytes ?? 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
});
async function refresh() {
  busy.value = true;
  error.value = '';
  try { stats.value = await requestJson('/api/cache/preview'); }
  catch (cause) { error.value = cause.message; }
  finally { busy.value = false; }
}
async function open() { show.value = true; stats.value = null; await refresh(); }
async function clear() {
  const action = await Dialog({ title: t('previewCacheClear'), message: t('previewCacheNote'), confirmButtonText: t('previewCacheClear'), cancelButtonText: t('cancel') });
  if (action !== 'confirm') return;
  busy.value = true;
  try {
    await requestJson('/api/cache/preview', { method: 'DELETE' });
    Snackbar.success(t('previewCacheCleared'));
    await refresh();
  } catch (cause) { error.value = cause.message; }
  finally { busy.value = false; }
}
</script>

<template>
  <var-button v-if="!hideTrigger" text @click="open"><MdiIcon :path="mdiDeleteOutline" />{{ t('previewCache') }}</var-button>
  <var-dialog v-model:show="show" :title="t('previewCache')" :confirm-button="false" :cancel-button="!busy" :close-on-click-overlay="!busy">
    <p>{{ t('previewCacheNote') }}</p>
    <p v-if="stats" aria-live="polite">{{ size }} · {{ t('previewCacheCount', { count: stats.count }) }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="preview-cache-actions">
      <var-button text :loading="busy" @click="refresh">{{ t('previewCacheRefresh') }}</var-button>
      <var-button type="primary" :disabled="busy || !stats?.count" @click="clear">{{ t('previewCacheClear') }}</var-button>
    </div>
  </var-dialog>
</template>

<style scoped>
.preview-cache-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
</style>
