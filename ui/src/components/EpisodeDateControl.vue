<script setup>
import { computed, ref, watch } from 'vue';
import { mdiCalendarEditOutline, mdiCloseCircleOutline } from '../icons.js';
import { t } from '../../../public/i18n.js';
import MdiIcon from './MdiIcon.vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  busy: { type: Boolean, default: false }
});
const emit = defineEmits(['save']);
const LAST_DATE_KEY = 'atp-comic.last-episode-date';
const open = ref(false);
const draft = ref(props.modelValue);
const manualDraft = ref('');
const label = computed(() => (
  props.modelValue ? `${t('assignEpisodeDate')}: ${props.modelValue}` : t('assignEpisodeDate')
));
const manualDate = computed(() => parseCompactDate(manualDraft.value));
const manualDateInvalid = computed(() => manualDraft.value.length > 0 && !manualDate.value);
const canSave = computed(() => !props.busy && !manualDateInvalid.value);

watch(() => props.modelValue, (value) => {
  if (!open.value) setDraft(value || defaultDate());
});

watch(open, (visible) => {
  if (visible) setDraft(props.modelValue || defaultDate());
});

function today() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function parseCompactDate(value) {
  if (!/^\d{8}$/.test(value)) return '';
  const formatted = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const [year, month, day] = formatted.split('-').map(Number);
  const candidate = new Date(year, month - 1, day);
  return candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day
    ? formatted
    : '';
}

function compactDate(value) {
  return value?.replaceAll('-', '') ?? '';
}

function defaultDate() {
  try {
    const saved = localStorage.getItem(LAST_DATE_KEY) ?? '';
    const parsed = parseCompactDate(compactDate(saved));
    if (parsed) return parsed;
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
  return today();
}

function setDraft(value) {
  draft.value = value;
  manualDraft.value = compactDate(value);
}

function selectDate(value) {
  const next = Array.isArray(value) ? value[0] ?? '' : value ?? '';
  setDraft(next);
}

function updateManual(value) {
  manualDraft.value = String(value ?? '').replace(/\D/g, '').slice(0, 8);
}

function clearDate() {
  setDraft('');
}

function cancel() {
  open.value = false;
}

function save() {
  if (!canSave.value) return;
  const value = manualDraft.value ? manualDate.value : '';
  if (value) {
    try {
      localStorage.setItem(LAST_DATE_KEY, value);
    } catch {
      // The selection still works when storage is unavailable.
    }
  }
  open.value = false;
  if (value !== props.modelValue) emit('save', value);
}
</script>

<template>
  <div class="episode-date-control" @click.stop>
    <var-menu v-model:show="open" placement="bottom-end" :offset-y="6" popover-class="episode-date-popover">
      <var-button
        round
        text
        :type="modelValue ? 'primary' : 'default'"
        :loading="busy"
        :aria-label="label"
        :title="label"
      >
        <MdiIcon :path="mdiCalendarEditOutline" />
      </var-button>
      <template #menu>
        <section class="episode-date-panel">
          <header>
            <span><strong>{{ t('assignEpisodeDate') }}</strong><small v-if="modelValue">{{ modelValue }}</small></span>
            <var-button v-if="manualDraft" round text size="small" :aria-label="t('clearEpisodeDate')" @click="clearDate"><MdiIcon :path="mdiCloseCircleOutline" /></var-button>
          </header>
          <var-input
            class="compact-input episode-date-input"
            :model-value="manualDraft"
            inputmode="numeric"
            maxlength="8"
            size="small"
            variant="outlined"
            :hint="false"
            :is-show-form-details="false"
            :placeholder="t('episodeDateInputPlaceholder')"
            :error="manualDateInvalid"
            :aria-label="t('episodeDateInputLabel')"
            @update:model-value="updateManual"
            @keydown.enter.prevent="save"
          />
          <var-date-picker
            class="episode-date-picker"
            :model-value="draft"
            type="date"
            :show-title="false"
            :elevation="false"
            @update:model-value="selectDate"
          />
          <footer>
            <var-button size="small" text @click="cancel">{{ t('cancel') }}</var-button>
            <var-button size="small" type="primary" :disabled="!canSave" :loading="busy" @click="save">{{ t('save') }}</var-button>
          </footer>
        </section>
      </template>
    </var-menu>
  </div>
</template>
