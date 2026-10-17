<script setup>
import { onMounted, ref, watch } from 'vue';
import { mdiAlertCircleOutline, mdiCheck, mdiFileImportOutline, mdiFolderCogOutline, mdiFolderRefreshOutline, mdiTuneVariant } from '../lib/icons.js';
import { t } from '../../../public/i18n.js';
import MdiIcon from './MdiIcon.vue';

const props = defineProps({
  busyAction: { type: String, default: null },
  issueCount: { type: Number, default: 0 },
  libraryLocation: { type: String, default: '' }
});

const emit = defineEmits(['import-json', 'issues', 'recognition', 'scan']);
const open = ref(false);
const choosing = ref(false);
const applying = ref(false);
const errorMessage = ref('');
const locationDraft = ref(props.libraryLocation);
const desktop = Boolean(window.atpDesktop?.chooseLibraryLocation);

watch(() => props.libraryLocation, (value) => {
  if (!open.value || !locationDraft.value.trim()) locationDraft.value = value;
});

async function applyLibraryLocation(value = locationDraft.value) {
  const selected = String(value ?? '').trim();
  if (!desktop || !selected || applying.value) return;
  applying.value = true;
  errorMessage.value = '';
  try {
    await window.atpDesktop.changeLibraryLocation(selected);
    open.value = false;
  } catch (error) {
    errorMessage.value = error.message ?? String(error);
  } finally {
    applying.value = false;
  }
}

async function chooseLibraryLocation() {
  if (!desktop || choosing.value) return;
  choosing.value = true;
  errorMessage.value = '';
  try {
    const selected = await window.atpDesktop.chooseLibraryLocation(locationDraft.value || props.libraryLocation);
    if (!selected) return;
    locationDraft.value = selected;
    await applyLibraryLocation(selected);
  } catch (error) {
    errorMessage.value = error.message ?? String(error);
  } finally {
    choosing.value = false;
  }
}

onMounted(async () => {
  if (!window.atpDesktop?.getLibraryLocationState) return;
  try {
    const state = await window.atpDesktop.getLibraryLocationState();
    if (state.prompt) open.value = true;
  } catch {
    // The normal source-server UI does not provide a desktop bridge.
  }
});
</script>

<template>
  <var-menu v-model:show="open" placement="bottom-end" :offset-y="6" popover-class="library-location-popover">
    <var-button
      size="small"
      text
      data-library-location-trigger
      :aria-expanded="open"
      aria-haspopup="menu"
      :title="`${t('libraryLocation')}: ${libraryLocation}`"
    >
      <MdiIcon :path="mdiFolderCogOutline" />{{ t('libraryMenu') }}
    </var-button>
    <template #menu>
      <section class="library-location-panel" data-library-location-panel>
        <header>
          <MdiIcon :path="mdiFolderCogOutline" />
          <span><strong>{{ t('libraryLocation') }}</strong><small>{{ t('libraryLocationSupporting') }}</small></span>
        </header>
        <var-input
          v-model="locationDraft"
          class="library-location-input"
          :readonly="!desktop"
          variant="outlined"
          :is-show-form-details="false"
          :aria-label="t('libraryLocationCurrent')"
          @keyup.enter="applyLibraryLocation()"
        />
        <p>{{ desktop ? t('libraryLocationNote') : t('libraryLocationSourceNote') }}</p>
        <p v-if="errorMessage" class="library-location-error">{{ errorMessage }}</p>
        <div v-if="desktop" class="library-location-actions">
          <var-button outline :loading="choosing" @click="chooseLibraryLocation">{{ t('chooseLibraryLocation') }}</var-button>
          <var-button type="primary" :loading="applying" :disabled="!locationDraft.trim()" @click="applyLibraryLocation()">
            <MdiIcon :path="mdiCheck" />{{ t('applyLibraryLocation') }}
          </var-button>
        </div>
        <div class="library-utility-actions">
          <var-button text :disabled="!!busyAction" :title="t('importJsonSupporting')" @click="open = false; emit('import-json')">
            <MdiIcon :path="mdiFileImportOutline" />{{ t('importJson') }}
          </var-button>
          <var-button text :loading="busyAction === 'scan'" :disabled="!!busyAction" @click="open = false; emit('scan')">
            <MdiIcon :path="mdiFolderRefreshOutline" />{{ t('scan') }}
          </var-button>
          <var-button text @click="open = false; emit('issues')">
            <MdiIcon :path="mdiAlertCircleOutline" />{{ t('issues') }}<var-badge v-if="issueCount" :value="issueCount" :max-value="999" type="warning" />
          </var-button>
          <var-button text @click="open = false; emit('recognition')">
            <MdiIcon :path="mdiTuneVariant" />{{ t('recognitionRules') }}
          </var-button>
        </div>
      </section>
    </template>
  </var-menu>
</template>

<style>
.library-location-popover { overflow: hidden !important; border: 1px solid var(--outline) !important; border-radius: var(--app-menu-radius, 16px) !important; background: var(--surface-highest) !important; }
.library-location-popover { --app-menu-radius: 20px; }
.library-location-panel { width: min(430px, calc(100vw - 24px)); display: grid; gap: 12px; padding: 16px; }
.library-location-panel header { display: flex; align-items: center; gap: 12px; }
.library-location-panel header > .mdi-icon { color: var(--primary); }
.library-location-panel header > span { min-width: 0; display: grid; gap: 2px; }
.library-location-panel header strong { font-size: 15px; font-weight: 600; }
.library-location-panel header small, .library-location-panel p { color: var(--muted); font-size: 11px; line-height: 1.5; }
.library-location-panel p { margin: 0; }
.library-location-panel .var-field-decorator, .library-location-panel .var-field-decorator__controller,
.library-location-panel .var-field-decorator__line { border-radius: 14px !important; }
.library-location-panel .var-input input { overflow: hidden; font-family: var(--font-mono); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.library-location-panel .library-location-error { color: var(--danger); }
.library-location-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.library-utility-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding-top: 8px; border-top: 1px solid var(--outline-soft); }
.library-utility-actions .var-button { justify-content: flex-start; }
.library-utility-actions .var-button__content { width: 100%; display: flex; align-items: center; gap: 7px; }
.library-utility-actions .var-badge { margin-left: auto; }

@media (max-width: 760px) {
  .library-location-panel { width: calc(100vw - 16px); max-height: calc(100dvh - 24px); overflow: auto; }
}
</style>
