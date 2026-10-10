<script setup>
import { computed, ref } from 'vue';
import { mdiCheck, mdiChevronDown, mdiPlaylistEdit, mdiSortAscending, mdiSortDescending } from '../lib/icons.js';
import { t } from '../../../public/i18n.js';
import { EPISODE_SORT_DATE_ASC, EPISODE_SORT_DATE_DESC, EPISODE_SORT_MANUAL } from '../../../public/collection-model.js';
import MdiIcon from './MdiIcon.vue';

const props = defineProps({
  modelValue: { type: String, default: EPISODE_SORT_DATE_ASC },
  manualAvailable: { type: Boolean, default: false }
});
const emit = defineEmits(['update:modelValue', 'change']);
const open = ref(false);

const options = computed(() => [
  { value: EPISODE_SORT_DATE_ASC, label: t('sortDateAsc'), icon: mdiSortAscending },
  { value: EPISODE_SORT_DATE_DESC, label: t('sortDateDesc'), icon: mdiSortDescending },
  ...(props.manualAvailable
    ? [{ value: EPISODE_SORT_MANUAL, label: t('sortManual'), icon: mdiPlaylistEdit }]
    : [])
]);
const current = computed(() => options.value.find((option) => option.value === props.modelValue) ?? options.value[0]);
const active = computed(() => props.modelValue !== EPISODE_SORT_MANUAL);

function select(option) {
  open.value = false;
  if (option.value === props.modelValue) return;
  emit('update:modelValue', option.value);
  emit('change');
}
</script>

<template>
  <div class="sort-filter-control">
    <var-menu v-model:show="open" placement="bottom-end" :offset-y="8" popover-class="sort-filter-popover">
      <var-button class="query-filter-trigger sort-filter-trigger" :class="{ active }" size="small" outline aria-haspopup="menu" :aria-expanded="open">
        <MdiIcon :path="current.icon" /><span>{{ current.label }}</span><MdiIcon class="filter-chevron" :path="mdiChevronDown" />
      </var-button>
      <template #menu>
        <section class="sort-filter-panel" role="menu" :aria-label="t('sortOrder')">
          <var-button
            v-for="option in options"
            :key="option.value"
            class="sort-option"
            :class="{ selected: option.value === modelValue }"
            block
            text
            role="menuitemradio"
            :aria-checked="option.value === modelValue"
            @click="select(option)"
          >
            <MdiIcon :path="option.icon" /><span>{{ option.label }}</span><MdiIcon v-if="option.value === modelValue" class="sort-option-check" :path="mdiCheck" />
          </var-button>
        </section>
      </template>
    </var-menu>
  </div>
</template>

<style>
.sort-filter-control { min-width: 0; position: relative; display: flex; align-items: center; }
.sort-filter-control > .var-menu { width: 100%; min-width: 0; display: flex; }
.sort-filter-popover { overflow: hidden !important; border: 1px solid var(--outline) !important; border-radius: 16px !important; background: var(--surface-highest) !important; }
.sort-filter-panel { width: 210px; display: grid; gap: 2px; padding: 6px; }
.sort-filter-panel .sort-option { min-height: 42px; justify-content: flex-start; border-radius: 12px !important; color: var(--text) !important; }
.sort-filter-panel .sort-option.selected { color: var(--on-secondary-container) !important; background: var(--secondary-container) !important; }
.sort-filter-panel .sort-option .var-button__content { width: 100%; display: flex; align-items: center; gap: 10px; }
.sort-filter-panel .sort-option .var-button__content > span { min-width: 0; flex: 1; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.sort-filter-panel .sort-option-check { flex: 0 0 auto; }
</style>
