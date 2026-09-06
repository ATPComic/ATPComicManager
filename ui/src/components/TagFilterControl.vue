<script setup>
import { computed, ref, watch } from 'vue';
import { mdiChevronDown, mdiCloseCircleOutline, mdiFilterVariant } from '../icons.js';
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

const emit = defineEmits(['change', 'update:modelValue']);
const open = ref(false);
const activeCategoryId = ref(null);

const selectedCount = computed(() => (
  Object.values(props.modelValue).reduce((count, values) => count + (values?.length ?? 0), 0)
));
const activeCategory = computed(() => (
  props.categories.find((category) => category.id === activeCategoryId.value)
  ?? props.categories.find((category) => props.modelValue[category.id]?.length)
  ?? props.categories[0]
  ?? null
));

watch(open, (visible) => {
  if (visible && !activeCategoryId.value) activeCategoryId.value = activeCategory.value?.id ?? null;
});
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
  open.value = false;
  emit('update:modelValue', {});
  emit('change');
}
</script>

<template>
  <div class="tag-filter-control">
    <var-menu v-model:show="open" placement="bottom-end" :offset-y="8" popover-class="tag-filter-popover">
      <var-button
        class="query-filter-trigger tag-filter-trigger"
        :class="{ active: selectedCount > 0 }"
        size="small"
        outline
        :aria-expanded="open"
        aria-haspopup="menu"
      >
        <MdiIcon :path="mdiFilterVariant" />
        <span>{{ t('filterTags') }}</span>
        <MdiIcon class="filter-chevron" :path="mdiChevronDown" />
      </var-button>
      <template #menu>
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
    </var-menu>
  </div>
</template>
