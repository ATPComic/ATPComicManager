<script setup>
import { computed, ref, watch } from 'vue';
import { mdiChevronDown, mdiClose, mdiFilterVariant } from '../lib/icons.js';
import { t } from '../../../public/i18n.js';
import { useTouchUi } from '../composables/use-touch-ui.js';
import MdiIcon from './MdiIcon.vue';
import TagFilterPanel from './TagFilterPanel.vue';
const props = defineProps({
  categories: { type: Array, default: () => [] }, categoryStyle: { type: Function, required: true },
  counts: { type: Object, default: () => ({}) }, modelValue: { type: Object, default: () => ({}) }
});
const emit = defineEmits(['change', 'update:modelValue']);
const open = ref(false);
const touch = useTouchUi();
const selected = computed(() => Object.values(props.modelValue).some(values => values?.length));
watch(touch, () => { open.value = false; });
function update(value) { emit('update:modelValue', value); emit('change'); }
</script>

<template>
  <div class="tag-filter-control">
    <var-menu :show="open && !touch" :trigger="touch ? 'manual' : 'click'" placement="bottom-end" :offset-y="8" popover-class="tag-filter-popover" @update:show="open = $event">
      <var-button class="query-filter-trigger tag-filter-trigger" :class="{ active: selected }" size="small" outline :aria-expanded="open" :aria-haspopup="touch ? 'dialog' : 'menu'" @click="touch && (open = !open)">
        <MdiIcon :path="mdiFilterVariant" /><span>{{ t('filterTags') }}</span><MdiIcon class="filter-chevron" :path="mdiChevronDown" />
      </var-button>
      <template #menu><TagFilterPanel v-if="!touch" v-bind="props" @update:model-value="update" @close="open = false" /></template>
    </var-menu>
    <var-popup v-if="touch" v-model:show="open" position="bottom" safe-area class="touch-tag-sheet">
      <section role="dialog" aria-modal="true" :aria-label="t('filterTags')">
        <header class="touch-tag-heading"><strong>{{ t('filterTags') }}</strong><var-button round text :aria-label="t('close')" @click="open = false"><MdiIcon :path="mdiClose" /></var-button></header>
        <TagFilterPanel v-bind="props" @update:model-value="update" @close="open = false" />
      </section>
    </var-popup>
  </div>
</template>

<style>
.touch-tag-sheet { width: 100%; border-radius: 20px 20px 0 0; background: var(--surface-high); }
.touch-tag-heading { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; }
.touch-tag-sheet .tag-filter-panel { width: 100%; max-width: 100%; height: min(65dvh, 560px); min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: 58px minmax(0, 1fr); }
.touch-tag-sheet .tag-filter-categories { display: flex; overflow-x: auto; border-right: 0; }
.touch-tag-sheet .tag-filter-categories > .var-badge { flex: 0 0 auto; width: auto; }
.touch-tag-sheet .tag-filter-values { overflow: auto; min-height: 0; }
</style>
