<script setup>
import { computed, ref, watch } from 'vue';
import { mdiCloseCircleOutline } from '../lib/icons.js';
import { t } from '../../../public/i18n.js';
import { flattenTagDefinitions } from '../../../public/tag-model.js';
import MdiIcon from './MdiIcon.vue';
import TagAssignmentPicker from './TagChipPicker.vue';

const props = defineProps({
  categories: { type: Array, default: () => [] },
  categoryStyle: { type: Function, required: true },
  counts: { type: Object, default: () => ({}) },
  modelValue: { type: Object, default: () => ({}) }
});

const emit = defineEmits(['change', 'update:modelValue', 'close']);
const activeCategoryId = ref(null);

const selectedCount = computed(() => (
  Object.values(props.modelValue).reduce((count, values) => count + values.length, 0)
));
const activeCategory = computed(() => (
  props.categories.find((category) => category.id === activeCategoryId.value)
  ?? props.categories.find((category) => props.modelValue[category.id]?.length)
  ?? props.categories[0]
  ?? null
));

watch(() => props.categories, () => {
  if (!props.categories.some((category) => category.id === activeCategoryId.value)) {
    activeCategoryId.value = activeCategory.value?.id ?? null;
  }
}, { deep: true });

function tagCount(categoryId) {
  return props.modelValue[categoryId]?.length ?? 0;
}

function categoryEntries(category) {
  return flattenTagDefinitions(category?.values ?? []);
}

function setSelection(categoryId, values) {
  const next = { ...props.modelValue };
  const normalized = [...new Set(values ?? [])];
  if (normalized.length) next[categoryId] = normalized;
  else delete next[categoryId];
  emit('update:modelValue', next);
  emit('change');
}

function clear() {
  emit('close');
  emit('update:modelValue', {});
  emit('change');
}
</script>

<template>
        <div class="tag-filter-panel">
          <nav class="tag-filter-categories" :aria-label="t('tagCategories')">
            <var-badge
              v-for="category in categories"
              :key="category.id"
              class="tag-category-filter-badge"
              position="right-top"
              :value="tagCount(category.id)"
              :hidden="!tagCount(category.id)"
              :offset-x="-8"
              :offset-y="8"
            >
              <var-button
                text
                block
                :class="{ active: activeCategory?.id === category.id }"
                :style="categoryStyle(category.id)"
                @click="activeCategoryId = category.id"
              >
                <span class="tag-emoji">{{ category.emoji || '🏷️' }}</span>
                <span>{{ category.name }}</span>
              </var-button>
            </var-badge>
          </nav>
          <section class="tag-filter-values">
            <header v-if="activeCategory">
              <span class="tag-filter-category-title"><span class="tag-emoji">{{ activeCategory.emoji || '🏷️' }}</span><strong>{{ activeCategory.name }}</strong></span>
              <var-button v-if="selectedCount" round text size="small" :aria-label="t('clearTagFilter')" @click="clear"><MdiIcon :path="mdiCloseCircleOutline" /></var-button>
            </header>
            <TagAssignmentPicker
              v-if="categoryEntries(activeCategory).length"
              :nodes="activeCategory.values"
              :model-value="modelValue[activeCategory.id] ?? []"
              :category-style="categoryStyle(activeCategory.id)"
              :counts="counts[activeCategory.id] ?? {}"
              @update:model-value="setSelection(activeCategory.id, $event)"
            />
            <span v-else class="muted">{{ t('emptyCategory') }}</span>
          </section>
        </div>

</template>

<style>
.tag-filter-panel { width: min(620px, calc(100vw - 32px)); min-height: 230px; max-height: min(520px, calc(100vh - 120px)); display: grid; grid-template-columns: minmax(160px, .8fr) minmax(260px, 1.5fr); overflow: hidden; }
.tag-filter-categories { padding: 10px; border-right: 1px solid var(--outline-soft); background: var(--surface-high); }
.tag-filter-categories > .var-badge { width: 100%; display: flex; margin: 2px 0; }
.tag-category-filter-badge { width: auto; min-width: 18px; display: inline-flex; margin: 0; }
.tag-filter-categories .var-button { min-height: 42px; justify-content: flex-start; border-radius: 14px !important; color: var(--muted) !important; }
.tag-filter-categories .var-button.active { color: var(--tag-on-container) !important; background: var(--tag-container) !important; }
.tag-filter-categories .var-button__content { width: 100%; display: flex; align-items: center; justify-content: flex-start; gap: 9px; }
.tag-filter-categories .var-button__content > span:nth-child(2) { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.tag-filter-values { min-width: 0; overflow: auto; padding: 16px; }
.tag-filter-values > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.tag-filter-category-title { min-width: 0; display: inline-flex; align-items: center; }
.tag-filter-values .tag-assignment-picker { width: 100%; }

@media (max-width: 760px) {
  .tag-filter-panel {
    width: calc(100vw - 16px);
    min-height: 0;
    max-height: min(70dvh, 560px);
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 58px minmax(180px, 1fr);
  }
  .tag-filter-categories {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 7px;
    border-right: 0;
    border-bottom: 1px solid var(--outline-soft);
    scrollbar-width: none;
    touch-action: pan-x;
  }
  .tag-filter-categories::-webkit-scrollbar { display: none; }
  .tag-filter-categories > .var-badge { width: auto; min-width: max-content; margin: 0; }
  .tag-filter-categories .var-button { min-width: max-content; min-height: 44px; padding-inline: 12px !important; }
  .tag-filter-values { padding: 12px; }
  .tag-filter-values > header { margin-bottom: 8px; }
}

@media (max-width: 760px) and (orientation: portrait) {
  .tag-filter-panel {
    width: calc(100vw - 16px);
    max-height: min(70dvh, 560px);
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 58px minmax(180px, 1fr);
  }
  .tag-filter-categories {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 7px;
    border-right: 0;
    border-bottom: 1px solid var(--outline-soft);
    scrollbar-width: none;
  }
  .tag-filter-categories > .var-badge { width: auto; min-width: max-content; margin: 0; }
  .tag-filter-categories .var-button { min-width: max-content; }
  .tag-filter-values { padding: 12px; }
}
</style>
