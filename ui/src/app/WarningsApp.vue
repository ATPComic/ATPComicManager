<script setup>
import PageSkeleton from '../components/PageSkeleton.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { Snackbar } from '@varlet/ui';
import { mdiAlertCircleOutline, mdiArrowRight, mdiChevronLeft, mdiRefresh } from '../lib/icons.js';
import SettingsMenu from '../components/SettingsMenu.vue';
import MdiIcon from '../components/MdiIcon.vue';
import { requestJson } from '../services/api.js';
import { navigateToPage, returnFromPage } from '../lib/navigation.js';
import { languageOptions, locale, t } from '../../../public/i18n.js';
import { pagesLocalStorageKey } from '../../../public/pages-assets-db.js';

const state = reactive({ library: { warnings: [] }, selectedType: null, errorsOnly: false });
const selectedLocale = ref(locale);
const currentPage = ref(1);
const pageSize = ref(20);
const refreshing = ref(false);
const WARNING_TYPE_KEYS = {
  'invalid-filename': 'warningTypeInvalidFilename',
  'unassigned-variant': 'warningTypeUnassignedVariant',
  'folder-file-date-mismatch': 'warningTypeFolderFileDateMismatch',
  'special-variant-base-missing': 'warningTypeSpecialVariantBaseMissing',
  'duplicate-page-number': 'warningTypeDuplicatePageNumber',
  'missing-pages': 'warningTypeMissingPages',
  'variant-mismatch': 'warningTypeVariantMismatch',
  'folder-conflict': 'warningTypeFolderConflict',
  'file-conflict': 'warningTypeFileConflict',
  'ambiguous-variant-token': 'warningTypeAmbiguousVariantToken',
  'duplicate-episode-source': 'warningTypeDuplicateEpisodeSource',
  'undated-episode': 'warningTypeUndatedEpisode',
  'missing-imported-episode': 'warningTypeMissingImportedEpisode',
  'missing-imported-image': 'warningTypeMissingImportedImage'
};

const groups = computed(() => {
  const result = new Map();
  for (const warning of state.library.warnings) {
    result.set(warning.type, (result.get(warning.type) ?? 0) + 1);
  }
  return [...result.entries()];
});

const filteredWarnings = computed(() => state.library.warnings.filter((warning) => {
  if (state.selectedType && warning.type !== state.selectedType) return false;
  return !state.errorsOnly || warning.severity === 'error';
}));

const pagedWarnings = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredWarnings.value.slice(start, start + pageSize.value);
});

const errorCount = computed(() => (
  state.library.warnings.filter((warning) => warning.severity === 'error').length
));
const localeOptions = languageOptions;

function warningTypeLabel(type) {
  const key = WARNING_TYPE_KEYS[type];
  return key ? t(key) : type;
}

function localizedWarningMessage(warning) {
  if (locale === 'en') return warning.message;
  const message = String(warning.message ?? '');
  let match;
  switch (warning.type) {
    case 'invalid-filename':
      match = message.match(/^Invalid filename: (.+)$/);
      return match ? t('warningInvalidFilename', { filename: match[1] }) : warningTypeLabel(warning.type);
    case 'unassigned-variant':
      match = message.match(/^Manual variant assignment required for (.+)$/);
      return match ? t('warningUnassignedVariant', { target: match[1] }) : warningTypeLabel(warning.type);
    case 'folder-file-date-mismatch':
      match = message.match(/^Folder (\S+) contains (.+)$/);
      return match ? t('warningFolderFileDateMismatch', { folder: match[1], filename: match[2] }) : warningTypeLabel(warning.type);
    case 'special-variant-base-missing':
      match = message.match(/^Special variant (\S+) has no base variant (\S+)$/);
      return match ? t('warningSpecialVariantBaseMissing', { variant: match[1], base: match[2] }) : warningTypeLabel(warning.type);
    case 'duplicate-page-number':
      match = message.match(/^Duplicate page number (.+)$/);
      return match ? t('warningDuplicatePageNumber', { page: match[1] }) : warningTypeLabel(warning.type);
    case 'missing-pages':
      match = message.match(/^Missing page (.+)$/);
      return match ? t('warningMissingPage', { page: match[1] }) : warningTypeLabel(warning.type);
    case 'variant-mismatch':
      match = message.match(/^Variant (\S+) has (\d+) pages while variant (\S+) has (\d+) pages$/);
      return match ? t('warningVariantMismatch', {
        reference: match[1], referenceCount: match[2], variant: match[3], count: match[4]
      }) : warningTypeLabel(warning.type);
    case 'folder-conflict':
      match = message.match(/^Folder conflict between (.+) and (.+)$/);
      return match ? t('warningFolderConflict', { left: match[1], right: match[2] }) : warningTypeLabel(warning.type);
    case 'file-conflict':
      match = message.match(/^File conflict between (.+) and (.+)$/);
      return match ? t('warningFileConflict', { left: match[1], right: match[2] }) : warningTypeLabel(warning.type);
    case 'ambiguous-variant-token':
      match = message.match(/^Multiple files share manual variant token (.+)$/);
      return match ? t('warningAmbiguousVariantToken', { token: match[1] }) : warningTypeLabel(warning.type);
    case 'duplicate-episode-source':
      match = message.match(/^Episode (\S+) appears in multiple scan roots$/);
      return match ? t('warningDuplicateEpisodeSource', { episode: match[1] }) : warningTypeLabel(warning.type);
    default:
      return message;
  }
}

function selectType(type) {
  state.selectedType = type;
  currentPage.value = 1;
}

function changeLocale(value) {
  localStorage.setItem(pagesLocalStorageKey(import.meta.env.BASE_URL, 'comic-manager.locale'), value);
  window.location.reload();
}

function openWarning(warning) {
  if (!warning.episodeId) return;
  const hasManualFiles = state.library.episodes[warning.episodeId]?.files?.some((file) => file.assignmentToken);
  if (hasManualFiles && ['unassigned-variant', 'missing-pages', 'variant-mismatch'].includes(warning.type)) {
    navigateToPage(`/variants.html?episode=${encodeURIComponent(warning.episodeId)}`);
    return;
  }
  navigateToPage(`/?episode=${encodeURIComponent(warning.episodeId)}`);
}

async function loadState() {
  const payload = await requestJson('/api/state');
  state.library = payload.library ?? state.library;
}

async function refresh() {
  refreshing.value = true;
  try {
    await loadState();
    Snackbar.success({ content: t('updatedLibrary'), position: 'bottom' });
  } catch (error) {
    Snackbar.error({ content: error.message, position: 'bottom' });
  } finally {
    refreshing.value = false;
  }
}

const pageLoading = ref(true);
onMounted(async () => {
  document.title = `${t('issuePageTitle')} · ${t('appTitle')}`;
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
  <div class="app-shell warnings-shell">
    <header class="top-app-bar">
      <div class="page-app-leading">
        <var-button round text :aria-label="t('back')" @click="returnFromPage('/')"><MdiIcon :path="mdiChevronLeft" /></var-button>
        <MdiIcon :path="mdiAlertCircleOutline" />
        <h1>{{ t('issuePageTitle') }}</h1>
      </div>
      <nav class="top-actions">
        <var-button size="small" text :loading="refreshing" @click="refresh"><MdiIcon :path="mdiRefresh" />{{ t('refresh') }}</var-button>
        <SettingsMenu
          v-model="selectedLocale"
          :options="localeOptions"
          @change="changeLocale"
        />
      </nav>
    </header>

    <main class="warnings-grid">
      <var-card class="warning-filter-pane" elevation="1">
        <header class="pane-heading compact"><div><span class="overline">{{ t('filterOverline') }}</span><h2>{{ t('issueTypes') }}</h2></div></header>
        <div class="warning-filter-list">
          <var-button block text class="warning-filter" :class="{ active: state.selectedType === null }" @click="selectType(null)">
            <span>{{ t('all') }}</span><var-badge :value="state.library.warnings.length" />
          </var-button>
          <var-button v-for="([type, count]) in groups" :key="type" block text class="warning-filter" :class="{ active: state.selectedType === type }" @click="selectType(type)">
            <span>{{ warningTypeLabel(type) }}</span><var-badge :value="count" />
          </var-button>
        </div>
      </var-card>

      <var-card class="warning-main-pane" elevation="1">
        <header class="pane-heading warning-heading">
          <div><span class="overline">{{ t('validationOverline') }}</span><h2>{{ state.selectedType ? warningTypeLabel(state.selectedType) : t('allIssues') }}</h2></div>
          <span class="warning-summary">{{ t('issueSummary', { count: state.library.warnings.length, errors: errorCount }) }}</span>
          <var-switch v-model="state.errorsOnly" @change="currentPage = 1" />
          <span>{{ t('errorsOnly') }}</span>
        </header>
        <div class="warning-list">
          <PageSkeleton v-if="pageLoading" />
          <var-cell
            v-for="warning in pagedWarnings"
            :key="`${warning.type}:${warning.episodeId}:${warning.path}:${warning.message}`"
            ripple
            class="warning-row"
            role="button"
            tabindex="0"
            @click="openWarning(warning)"
            @keydown.enter.space.prevent="openWarning(warning)"
          >
            <template #icon><var-chip :type="warning.severity === 'error' ? 'danger' : 'warning'">{{ t(warning.severity === 'error' ? 'severityError' : 'severityWarning') }}</var-chip></template>
            <span class="warning-copy"><strong>{{ localizedWarningMessage(warning) }}</strong><small>{{ warning.episodeId }} · {{ warning.path }}</small></span>
            <template #extra><span class="warning-open">{{ t('open') }}<MdiIcon :path="mdiArrowRight" /></span></template>
          </var-cell>
          <div v-if="!pageLoading && !filteredWarnings.length" class="empty-state">{{ t('noIssues') }}</div>
        </div>
        <footer v-if="filteredWarnings.length" class="pagination-footer">
          <var-pagination
            v-model:current="currentPage"
            v-model:size="pageSize"
            :total="filteredWarnings.length"
            :simple="false"
            :max-pager-count="7"
            show-size-changer
            show-quick-jumper
            :size-option="[10, 20, 50, 100]"
            :show-total="(total, range) => `${range[0]}–${range[1]} / ${total}`"
          />
        </footer>
      </var-card>
    </main>
  </div>
</template>

<style>
.warnings-grid { height: calc(100% - var(--titlebar-height)); display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 12px; padding: 12px; }

.warning-filter-pane, .warning-main-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--outline-soft);
  border-radius: 28px !important;
  background: var(--surface) !important;
}
.warning-filter-pane .var-card__floater,
.warning-filter-pane .var-card__container,
.warning-filter-pane .var-card__content,
.warning-main-pane .var-card__floater,
.warning-main-pane .var-card__container,
.warning-main-pane .var-card__content { height: 100%; min-height: 0; }
.warning-filter-pane .var-card__content,
.warning-main-pane .var-card__content { display: flex; flex-direction: column; }

.warning-filter-list { min-height: 0; flex: 1; overflow: auto; padding: 4px 10px 16px; }
.warning-filter { min-height: 52px !important; margin: 2px 0; padding: 0 14px !important; border-radius: 16px !important; color: var(--text) !important; }
.warning-filter .var-button__content { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.warning-filter.active { color: var(--on-secondary-container) !important; background: var(--secondary-container) !important; }

.warning-heading { display: flex; align-items: center; justify-content: flex-start; }
.warning-summary { margin-left: auto; color: var(--muted); font-size: 12px; }
.warning-heading .var-switch { margin-left: auto; }
.warning-summary + .var-switch { margin-left: 8px; }
.warning-heading > span:last-child { color: var(--muted); font-size: 13px; }

.warning-list { min-height: 0; flex: 1; overflow: auto; padding: 0 10px 8px; }
.warning-row { width: 100%; min-height: 66px; display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 8px 12px; border: 0; border-radius: 18px; color: var(--text); background: transparent; text-align: left; cursor: pointer; }
.warning-row:hover { background: var(--surface-high); }
.warning-row .var-cell__content { min-width: 0; }
.warning-row .var-cell__extra { min-width: 0; }
.warning-copy { min-width: 0; }
.warning-copy strong, .warning-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warning-copy strong { font-size: 13px; font-weight: 550; }
.warning-copy small { margin-top: 5px; color: var(--muted); font-family: var(--font-mono); font-size: 11px; }
.warning-open { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px; }

.pagination-footer { display: flex; align-items: center; min-height: 72px; justify-content: center; padding: 10px 16px; border-top: 1px solid var(--outline-soft); }
.pagination-footer .var-pagination { width: 100%; justify-content: center; }

@media (max-width: 760px) {
  .warnings-grid {
    height: calc(100dvh - var(--titlebar-height));
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 102px minmax(0, 1fr);
    gap: 0;
    padding: 0;
  }
  .warning-filter-pane, .warning-main-pane { width: 100%; height: auto; border-width: 0 0 1px; border-radius: 0 !important; }
  .warning-filter-pane .pane-heading { min-height: 36px; padding: 4px 10px 0; }
  .warning-filter-pane .pane-heading h2 { font-size: 16px; }
  .warning-filter-list { display: flex; gap: 4px; overflow-x: auto; overflow-y: hidden; padding: 4px 8px 8px; scrollbar-width: none; touch-action: pan-x; }
  .warning-filter-list::-webkit-scrollbar { display: none; }
  .warning-filter { min-width: max-content !important; min-height: 48px !important; margin: 0; padding-inline: 12px !important; }
  .warning-heading { min-height: 62px; flex-wrap: wrap; gap: 3px 7px; padding: 6px 10px; }
  .warning-heading > div:first-child { width: 100%; }
  .warning-heading h2 { font-size: 16px; }
  .warning-heading .overline { display: none; }
  .warning-summary { margin-left: 0; }
  .warning-heading .var-switch { margin-left: auto; }
  .warning-row { min-height: 72px; grid-template-columns: 68px minmax(0, 1fr); gap: 8px; padding: 8px 6px; border-radius: 12px; }
  .warning-open, .warning-row .var-cell__extra { display: none; }
  .warning-copy strong, .warning-copy small { white-space: normal; overflow-wrap: anywhere; }
  .pagination-footer { min-height: 56px; overflow-x: auto; justify-content: flex-start; padding: 6px 8px calc(6px + env(safe-area-inset-bottom)); }
  .pagination-footer .var-pagination { width: max-content; min-width: 100%; justify-content: flex-start; }
}
</style>
