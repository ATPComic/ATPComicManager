<script setup>
import PageSkeleton from './components/PageSkeleton.vue';
import { onMounted, reactive, ref, toRaw } from 'vue';
import { Snackbar } from '@varlet/ui';
import {
  mdiCheck,
  mdiChevronLeft,
  mdiContentSaveOutline,
  mdiDeleteOutline,
  mdiDragVertical,
  mdiPaletteOutline,
  mdiPlus,
  mdiTagPlusOutline,
  mdiTagMultipleOutline
} from './icons.js';
import LanguageMenu from './components/LanguageMenu.vue';
import MdiIcon from './components/MdiIcon.vue';
import TagTreeEditor from './components/TagTreeEditor.vue';
import { requestJson } from './api.js';
import { returnFromPage } from './navigation.js';
import {
  TAG_CATEGORY_COLORS,
  normalizeCategoryColor,
  tagCategoryColor,
  tagCategoryStyle
} from './tag-colors.js';
import { locale, t } from '../../public/i18n.js';
import { migrateTagMap, normalizeTagDefinition, relocateTagDefinition } from '../../public/tag-model.js';

const state = reactive({
  tags: { version: 3, categories: [], episodeTags: {} },
  themes: [],
  busy: false
});
const selectedLocale = ref(locale);
const draftCategories = ref([]);
const colorMenuId = ref(null);
const draggedCategoryIndex = ref(null);
const categoryDropIndex = ref(null);

const localeOptions = [
  { label: t('languageEnglish'), value: 'en' },
  { label: t('languageJapanese'), value: 'ja' },
  { label: t('languageChineseSimplified'), value: 'zh-CN' },
  { label: t('languageChineseTraditional'), value: 'zh-TW' }
];

function cloneData(value) {
  return structuredClone(toRaw(value));
}

function createStableId(prefix) {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function initialCategories(categories) {
  const initial = categories.length
    ? cloneData(categories)
    : [
        { id: createStableId('category'), name: t('people'), emoji: '👥', values: [] },
        { id: createStableId('category'), name: t('style'), emoji: '🎨', values: [] }
      ];
  return initial.map((category, index) => ({
    ...category,
    color: normalizeCategoryColor(category.color) || TAG_CATEGORY_COLORS[index % TAG_CATEGORY_COLORS.length].accent
  }));
}

function categoryStyle(category) {
  return tagCategoryStyle(category, draftCategories.value);
}

function categoryColor(category) {
  return tagCategoryColor(category, draftCategories.value);
}

function isColorSelected(category, preset) {
  const color = normalizeCategoryColor(category.color);
  return preset ? !!color && categoryColor(category).id === preset.id : !color;
}

function selectColor(category, preset) {
  category.color = preset?.accent ?? '';
  colorMenuId.value = null;
}

function addCategory() {
  const color = TAG_CATEGORY_COLORS[draftCategories.value.length % TAG_CATEGORY_COLORS.length].accent;
  draftCategories.value.push({ id: createStableId('category'), emoji: '', name: '', color, values: [] });
}

function addTag(category) {
  category.values.push({ id: createStableId('tag'), emoji: '', name: '', values: [] });
}

function startCategoryDrag(index, event) {
  draggedCategoryIndex.value = index;
  categoryDropIndex.value = index;
  event.dataTransfer?.setData('text/plain', String(index));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function updateCategoryDrop(index, event) {
  if (draggedCategoryIndex.value === null) return;
  event.preventDefault();
  const bounds = event.currentTarget.getBoundingClientRect();
  categoryDropIndex.value = index + (event.clientY > bounds.top + bounds.height / 2 ? 1 : 0);
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function dropCategory(event) {
  event.preventDefault();
  const source = draggedCategoryIndex.value;
  let target = categoryDropIndex.value;
  if (source === null || target === null) return clearCategoryDrag();
  const [category] = draftCategories.value.splice(source, 1);
  if (source < target) target -= 1;
  draftCategories.value.splice(target, 0, category);
  clearCategoryDrag();
}

function clearCategoryDrag() {
  draggedCategoryIndex.value = null;
  categoryDropIndex.value = null;
}

function restructure(event) {
  relocateTagDefinition(draftCategories.value, event?.source, event?.target);
}

function normalizeDraftTree(values) {
  return (values ?? []).map((value) => {
    const normalized = normalizeTagDefinition(value);
    return {
      id: normalized.id || createStableId('tag'),
      name: normalized.name,
      emoji: normalized.emoji,
      values: normalizeDraftTree(value.values)
    };
  }).filter((value) => value.name || value.emoji);
}

function normalizedCategories() {
  return draftCategories.value.map((category) => {
    const normalized = normalizeTagDefinition(category);
    const color = normalizeCategoryColor(category.color);
    return {
      id: category.id || createStableId('category'),
      name: normalized.name,
      emoji: normalized.emoji,
      ...(color ? { color } : {}),
      values: normalizeDraftTree(category.values)
    };
  }).filter((category) => category.name || category.emoji);
}

async function loadState({ resetDraft = true } = {}) {
  const payload = await requestJson('/api/state');
  state.tags = payload.tags ?? state.tags;
  state.themes = payload.themes ?? [];
  if (resetDraft) draftCategories.value = initialCategories(state.tags.categories ?? []);
}

async function saveTags() {
  if (state.busy) return;
  state.busy = true;
  try {
    const categories = normalizedCategories();
    const episodeTags = {};
    for (const [episodeId, tags] of Object.entries(state.tags.episodeTags ?? {})) {
      const migrated = migrateTagMap(tags, categories, {}, state.tags.categories);
      if (Object.keys(migrated).length) episodeTags[episodeId] = migrated;
    }
    await requestJson('/api/tags', {
      method: 'PUT',
      body: JSON.stringify({ ...state.tags, version: 3, categories, episodeTags })
    });
    await Promise.all(state.themes.map(async (theme) => {
      const tags = migrateTagMap(theme.tags, categories, {}, state.tags.categories);
      if (JSON.stringify(tags) !== JSON.stringify(theme.tags ?? {})) {
        await requestJson('/api/themes', {
          method: 'POST',
          body: JSON.stringify({ ...theme, tags })
        });
      }
    }));
    await loadState();
    Snackbar.success({ content: t('savedTags'), position: 'bottom' });
  } catch (error) {
    Snackbar.error({ content: t('saveTagsFailed', { message: error.message }), position: 'bottom' });
  } finally {
    state.busy = false;
  }
}

function changeLocale(value) {
  localStorage.setItem('comic-manager.locale', value);
  window.location.reload();
}

const pageLoading = ref(true);
onMounted(async () => {
  document.title = `${t('tags')} · ${t('appTitle')}`;
  document.documentElement.lang = locale;
  try {
    await loadState();
  } catch (error) {
    Snackbar.error({ content: error.message, position: 'bottom' });
  } finally {
    pageLoading.value = false;
  }
});
</script>

<template>
  <div class="tag-page-shell">
    <header class="top-app-bar tag-app-bar">
      <div class="page-app-leading">
        <var-button round text :aria-label="t('back')" @click="returnFromPage('/')"><MdiIcon :path="mdiChevronLeft" /></var-button>
        <MdiIcon :path="mdiTagMultipleOutline" />
        <h1>{{ t('tags') }}</h1>
      </div>
      <div class="top-actions">
        <var-button size="small" type="primary" :loading="state.busy" @click="saveTags"><MdiIcon :path="mdiContentSaveOutline" />{{ t('save') }}</var-button>
        <LanguageMenu v-model="selectedLocale" :options="localeOptions" :label="t('language')" @change="changeLocale" />
      </div>
    </header>

    <PageSkeleton v-if="pageLoading" />
    <main v-show="!pageLoading" class="tag-page-workspace">
      <header class="tag-page-intro">
        <p>{{ t('tagSystemNote') }}</p>
        <var-button type="primary" tonal @click="addCategory"><MdiIcon :path="mdiPlus" />{{ t('addCategory') }}</var-button>
      </header>
      <div class="tag-category-grid">
        <var-card
          v-for="(category, categoryIndex) in draftCategories"
          :key="category.id || categoryIndex"
          class="tag-category-card"
          :class="{
            dragging: draggedCategoryIndex === categoryIndex,
            'drop-before': categoryDropIndex === categoryIndex,
            'drop-after': categoryDropIndex === categoryIndex + 1
          }"
          :style="categoryStyle(category)"
          elevation="1"
          @dragover="updateCategoryDrop(categoryIndex, $event)"
          @drop="dropCategory"
        >
          <div class="tag-category-heading">
            <span class="tag-category-drag" draggable="true" role="button" tabindex="0" :aria-label="t('dragTag')" :title="t('dragTag')" @dragstart="startCategoryDrag(categoryIndex, $event)" @dragend="clearCategoryDrag"><MdiIcon :path="mdiDragVertical" /></span>
            <var-input v-model="category.emoji" class="compact-input emoji-input" :class="{ 'is-empty': !category.emoji }" size="small" variant="outlined" :hint="false" :is-show-form-details="false" placeholder="☺︎" :aria-label="t('categoryEmoji')" />
            <var-input v-model="category.name" class="compact-input" size="small" variant="outlined" :hint="false" :is-show-form-details="false" :placeholder="t('categoryName')" />
            <var-button round text icon-container size="small" class="tag-category-delete danger-action" :aria-label="t('deleteCategory')" :title="t('deleteCategory')" @click="draftCategories.splice(categoryIndex, 1)"><MdiIcon :path="mdiDeleteOutline" /></var-button>
          </div>
          <TagTreeEditor :nodes="category.values" :category-id="category.id" @restructure="restructure" />
          <footer class="tag-category-footer">
            <var-button size="small" text tonal @click="addTag(category)"><MdiIcon :path="mdiTagPlusOutline" />{{ t('addTag') }}</var-button>
            <div class="tag-color-picker">
              <var-menu
                :show="colorMenuId === category.id"
                trigger="manual"
                placement="top-end"
                :offset-y="6"
                popover-class="tag-color-popover"
                @update:show="colorMenuId = $event ? category.id : null"
              >
                <var-button class="tag-color-trigger" text icon-container :aria-label="t('categoryColor')" :title="t('categoryColor')" @click="colorMenuId = colorMenuId === category.id ? null : category.id">
                  <span class="tag-color-swatch" :style="{ background: categoryColor(category).accent }"><MdiIcon :path="mdiPaletteOutline" /></span>
                </var-button>
                <template #menu>
                  <div class="tag-color-palette" role="listbox" :aria-label="t('categoryColor')">
                    <var-button
                      v-for="preset in TAG_CATEGORY_COLORS"
                      :key="preset.id"
                      class="tag-color-option"
                      :class="{ selected: isColorSelected(category, preset) }"
                      text
                      icon-container
                      role="option"
                      :aria-selected="isColorSelected(category, preset)"
                      :aria-label="t(preset.nameKey)"
                      :title="t(preset.nameKey)"
                      @click="selectColor(category, preset)"
                    >
                      <span class="tag-color-option-swatch" :style="{ background: preset.container, color: preset.onContainer, borderColor: preset.accent }"></span>
                      <MdiIcon v-if="isColorSelected(category, preset)" class="tag-color-check" :style="{ color: preset.onContainer }" :path="mdiCheck" size="16" />
                    </var-button>
                  </div>
                </template>
              </var-menu>
            </div>
          </footer>
        </var-card>
      </div>
    </main>
  </div>
</template>
