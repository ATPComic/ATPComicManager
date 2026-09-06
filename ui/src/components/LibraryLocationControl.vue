<script setup>
import { onMounted, ref, watch } from 'vue';
import { mdiAlertCircleOutline, mdiCheck, mdiFileImportOutline, mdiFolderCogOutline, mdiFolderRefreshOutline, mdiTuneVariant } from '../icons.js';
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
