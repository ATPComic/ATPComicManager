<script setup>
import PageSkeleton from './components/PageSkeleton.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { Snackbar } from '@varlet/ui';
import { mdiAlertCircleOutline, mdiArrowRight, mdiChevronLeft, mdiRefresh } from './icons.js';
import LanguageMenu from './components/LanguageMenu.vue';
import MdiIcon from './components/MdiIcon.vue';
import { requestJson } from './api.js';
import { navigateToPage, returnFromPage } from './navigation.js';
import { locale, t } from '../../public/i18n.js';

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
  for (const warning of state.library.warnings ?? []) {
    result.set(warning.type, (result.get(warning.type) ?? 0) + 1);
  }
  return [...result.entries()];
});

const filteredWarnings = computed(() => (state.library.warnings ?? []).filter((warning) => {
  if (state.selectedType && warning.type !== state.selectedType) return false;
  return !state.errorsOnly || warning.severity === 'error';
}));

const pagedWarnings = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredWarnings.value.slice(start, start + pageSize.value);
});

const errorCount = computed(() => (
  (state.library.warnings ?? []).filter((warning) => warning.severity === 'error').length
));
const localeOptions = computed(() => [
  { label: t('languageEnglish'), value: 'en' },
  { label: t('languageJapanese'), value: 'ja' },
  { label: t('languageChineseSimplified'), value: 'zh-CN' },
  { label: t('languageChineseTraditional'), value: 'zh-TW' }
]);

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
  localStorage.setItem('comic-manager.locale', value);
  window.location.reload();
}

function openWarning(warning) {
  if (!warning.episodeId) return;
  const hasManualFiles = state.library.episodes?.[warning.episodeId]?.files?.some((file) => file.assignmentToken);
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
        <LanguageMenu
          v-model="selectedLocale"
          :options="localeOptions"
          :label="t('language')"
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
