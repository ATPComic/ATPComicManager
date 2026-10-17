<script setup>
import PageSkeleton from '../components/PageSkeleton.vue';
import { useTouchUi } from '../composables/use-touch-ui.js';
import { scrollHeaderState } from '../../../public/scroll-header.js';
import DiscoveryFeed from '../components/DiscoveryFeed.vue';
import PagesLibraryControl from '../components/PagesLibraryControl.vue';
import PagesAccessBanner from '../components/PagesAccessBanner.vue';
import { pagesText } from '../../../public/locales/pages.js';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { Dialog, Snackbar } from '@varlet/ui';
import {
  mdiBookMultipleOutline,
  mdiArrowDown,
  mdiBookOpenPageVariantOutline,
  mdiChevronLeft,
  mdiChevronRight,
  mdiCogOutline,
  mdiDeleteOutline,
  mdiDragVertical,
  mdiFolderOpenOutline,
  mdiFullscreen,
  mdiImageOutline,
  mdiInboxOutline,
  mdiMagnify,
  mdiMagnifyMinusOutline,
  mdiMagnifyPlusOutline,
  mdiPencilOutline,
  mdiPlus,
  mdiSelectionEllipse,
  mdiShuffleVariant,
  mdiTagArrowDownOutline,
  mdiTagOutline,
  mdiTagPlusOutline,
  mdiTuneVariant,
  mdiWindowClose,
  mdiWindowMinimize,
  mdiWindowRestore,
} from '../lib/icons.js';
import AppTopBar from '../components/AppTopBar.vue';
import MdiIcon from '../components/MdiIcon.vue';
import ReaderHelp from '../components/ReaderHelp.vue';
import ReaderSlider from '../components/ReaderSlider.vue';
import ReaderVariants from '../components/ReaderVariants.vue';
import TagAssignmentPicker from '../components/TagChipPicker.vue';
import TagDisplayChip from '../components/TagDisplayChip.vue';
import TagFilterControl from '../components/TagFilterControl.vue';
import DateFilterControl from '../components/DateFilterControl.vue';
import SortControl from '../components/SortControl.vue';
import EpisodeDateControl from '../components/EpisodeDateControl.vue';
import { chooseAndroidLibrary, isAndroidApp, isPagesApp, nativeAssetUrl, requestJson } from '../services/api.js';
import SettingsMenu from '../components/SettingsMenu.vue';
import { downloadJsonFile } from '../lib/download.js';
import { cloneData } from '../lib/clone-data.js';
import { navigateToPage, returnPathFromHref, variantEpisodePath } from '../lib/navigation.js';
import { tagCategoryStyle as getTagCategoryStyle } from '../lib/tag-colors.js';
import { EPISODE_DRAG_TYPE, EPISODE_SORT_DATE_ASC, EPISODE_SORT_MANUAL, draggedEpisodeId, compareEpisodesByDate, countTagEpisodes, matchesDateFilter, matchesTagFilter, moveItemToSlot, sortEpisodeIds, rowInsertionIndex } from '../../../public/collection-model.js';
import { locale, t } from '../../../public/i18n.js';
import { ComicReader } from '../../../public/reader.js';
import { getThumbnailUrl, setReaderAssetUrlResolver } from '../../../public/reader-model.js';
import { readInitialViewState } from '../../../public/view-state.js';
import { flattenTagDefinitions, getOrderedTagEntries } from '../../../public/tag-model.js';
import { createEmptyTagState, mergeTagMaps } from '../../../public/tag-state.js';
import { createEmptyRecognitionState } from '../../../public/recognition-state.js';
import { getVirtualWindow } from '../../../public/virtual-list.js';
import { pagesLocalStorageKey } from '../../../public/pages-assets-db.js';

const READER_SETTINGS_KEY = pagesLocalStorageKey(import.meta.env.BASE_URL, 'comic-manager.reader-settings');
const layoutLabel = layout => t(({ 'month-flat': 'layoutMonthly', folder: 'layoutDaily', 'rule-folder': 'layoutCustom' })[layout] ?? 'layoutUnknown');
const ROW_HEIGHT = 100;
const COLLECTION_PREVIEW_LIMIT = 8;
const desktopWindowControls = Boolean(window.atpDesktop?.controlWindow);
const initialViewState = readInitialViewState(window.location.search);
let pendingInitialEpisodeId = initialViewState.selectedEpisodeId;
let pendingFocusedEpisodeId = initialViewState.focusedEpisodeId;
let readerReturnPath = pendingInitialEpisodeId ? returnPathFromHref(window.location.href, null) : null;

const state = reactive({
  library: { episodes: {}, warnings: [] },
  themes: [],
  tags: createEmptyTagState(),
  recognition: createEmptyRecognitionState(),
  runtime: { workspaceRoot: '' },
  selectedThemeTitle: null,
  selectedEpisodeId: null,
  search: '',
  unassignedOnly: false,
  tagFilters: {},
  dateFilter: { granularity: 'month', start: '', end: '' },
  draggedEpisodeId: null,
  busyAction: null
});
const androidLibraryInitialized = ref(false);
const androidImportOpen = ref(false);
const copyAndroidLibrary = ref(false);

const listRef = ref(null);
const collectionListRef = ref(null);
const readerRoot = ref(null);
const scrollTop = ref(0);
const viewportHeight = ref(650);
const tagDialogOpen = ref(false);
const tagDialogKind = ref(null);
const tagDialogId = ref(null);
const tagDraftSelection = reactive({});
const nameDialogOpen = ref(false);
const nameDialogMode = ref('create');
const nameDraft = ref('');
const settingsDialogOpen = ref(false);
const recognitionDialogOpen = ref(false);
const recognitionDraft = reactive({ version: 1, rules: [], episodeDates: {}, identityMarkers: [] });
const settingsDraft = reactive({ radius: 144, feather: 32, animationSpeed: 100, mode: 'single', order: 'ltr', fit: 'screen', pageAnimation: true, focusDim: true });
const readerModeOptions = [
  { label: t('readerModeSingle'), value: 'single', ripple: true },
  { label: t('readerModeContinuous'), value: 'continuous', ripple: true },
  { label: t('readerModeFocus'), value: 'focus', ripple: true }
];
const readerOrderOptions = [
  { label: t('readingOrderLtr'), value: 'ltr', ripple: true },
  { label: t('readingOrderRtl'), value: 'rtl', ripple: true },
  { label: t('readingOrderTtb'), value: 'ttb', ripple: true }
];
const readerFitOptions = [
  { label: t('pageFitScreen'), value: 'screen', ripple: true },
  { label: t('pageFitFill'), value: 'fill', ripple: true }
];
const lastPointerWasTouch = ref(false);
const selectedLocale = ref(locale);
const dropIndex = ref(null);
const dropThemeTitle = ref(null);
const pageSliderRef = ref(null);
const episodeSliderRef = ref(null);
const readerVariantsRef = ref(null);
const mobileCollectionOpen = ref(false);
const discoveryOpen = ref(Boolean(window.history.state?.discovery));

function openDiscovery() {
  window.history.pushState({ ...(window.history.state ?? {}), discovery: true }, '');
  discoveryOpen.value = true;
}

function closeDiscovery() {
  if (window.history.state?.discovery) window.history.back();
  else discoveryOpen.value = false;
}
const portraitReaderMode = window.matchMedia('(max-width: 760px) and (orientation: portrait)');
const touchUi = useTouchUi();
const touchGesture = ref(false);
const headerHidden = ref(false);
const scrollPositions = new WeakMap();
function onPageScroll(event) {
  const target = event.target;
  if (!touchUi.value || !target?.matches?.('.episode-scroll, .collection-list, .discovery-scroll')) return;
  const next = scrollHeaderState(scrollPositions.get(target) ?? { top: 0, hidden: false, travel: 0 }, Math.max(0, target.scrollTop), Math.max(0, target.scrollHeight - target.clientHeight));
  scrollPositions.set(target, next);
  headerHidden.value = next.hidden;
}

let reader;
let resizeObserver;
let scrollFrame = 0;
let suppressCollectionClickUntil = 0;
let suppressEpisodeClickUntil = 0;

function tagDefinitionLabel(definition, fallback = '') {
  if (!definition) return fallback;
  return [definition.emoji, definition.name].filter(Boolean).join(' ') || fallback;
}

function tagPathLabel(path, fallback = '') {
  if (!path?.length) return fallback;
  const ancestors = path.slice(0, -1).map((part) => part.emoji).filter(Boolean);
  const leaf = tagDefinitionLabel(path.at(-1), fallback);
  return [...ancestors, leaf].filter(Boolean).join(' › ') || fallback;
}

function loadReaderSettings() {
  try {
    return JSON.parse(localStorage.getItem(READER_SETTINGS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function episodeIds() {
  return Object.entries(state.library.episodes).sort(compareEpisodesByDate).map(([episodeId]) => episodeId);
}

function episodeLabel(episodeId) {
  return state.library.episodes[episodeId]?.title ?? episodeId;
}

const activeTheme = computed(() => (
  state.themes.find((theme) => theme.title === state.selectedThemeTitle) ?? null
));

function themesForEpisode(episodeId) {
  return state.themes
    .filter((theme) => (theme.episodes ?? []).includes(episodeId))
    .map((theme) => theme.title);
}

function warningsForEpisode(episodeId) {
  return state.library.warnings.filter((warning) => warning.episodeId === episodeId);
}

function variantSummary(episode) {
  return variantStats(episode)
    .map(({ variant, count }) => `${variant}${count}`)
    .join('  ');
}

function variantStats(episode) {
  return Object.entries(episode.variants ?? {})
    .filter(([, pages]) => pages?.length)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([variant, pages]) => ({ variant, count: pages.length }));
}

function tagCategoryStyle(categoryOrId) {
  return getTagCategoryStyle(categoryOrId, state.tags.categories);
}

function orderedTagItems(tags) {
  return getOrderedTagEntries(tags, state.tags.categories).map((entry) => ({
    ...entry,
    key: `${entry.categoryId}:${entry.valueId}`,
    label: tagPathLabel(entry.path, String(entry.valueId))
  }));
}

function flattenTags(tags) {
  return orderedTagItems(tags).map((item) => item.label);
}

function categoryTagEntries(category) {
  return flattenTagDefinitions(category?.values ?? []);
}

function pruneTagFilters() {
  const next = {};
  for (const category of state.tags.categories) {
    const allowed = new Set(categoryTagEntries(category).map((entry) => entry.id));
    const values = (state.tagFilters[category.id] ?? []).filter((valueId) => allowed.has(valueId));
    if (values.length) next[category.id] = values;
  }
  state.tagFilters = next;
}

const unassignedEpisodeIds = computed(() => (
  episodeIds().filter((episodeId) => themesForEpisode(episodeId).length === 0)
));

const filterScopeEpisodeIds = computed(() => {
  const query = state.search.trim().toLowerCase();
  const source = activeTheme.value
    ? [...new Set(activeTheme.value.episodes ?? [])]
    : episodeIds();

  return source.filter((episodeId) => {
    const themes = themesForEpisode(episodeId);
    if (state.unassignedOnly && themes.length) return false;
    if (!query) return true;
    const episode = state.library.episodes[episodeId] ?? {};
    const tags = flattenTags(state.tags.episodeTags[episodeId]).join(' ');
    return [episodeId, episode.title, episode.date, layoutLabel(episode.layout), themes.join(' '), variantSummary(episode), tags]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
});

const tagEpisodeCounts = computed(() => countTagEpisodes(
  filterScopeEpisodeIds.value,
  state.tags.episodeTags,
  state.tags.categories
));

const reverseCollections = ref(false);
const sortMode = ref(EPISODE_SORT_MANUAL);
const effectiveSortMode = computed({
  get: () => ((activeTheme.value || sortMode.value !== EPISODE_SORT_MANUAL) ? sortMode.value : EPISODE_SORT_DATE_ASC),
  set: (value) => { sortMode.value = value; }
});
const displayedThemes = computed(() => reverseCollections.value ? [...state.themes].reverse() : state.themes);
const filteredEpisodeIds = computed(() => sortEpisodeIds(
  filterScopeEpisodeIds.value.filter((episodeId) => (
    matchesTagFilter(state.tags.episodeTags[episodeId], state.tagFilters, state.tags.categories)
    && matchesDateFilter(episodeId, state.library.episodes[episodeId], state.dateFilter)
  )),
  state.library.episodes,
  sortMode.value
));

const visibleRows = computed(() => {
  const { start, end } = getVirtualWindow(
    filteredEpisodeIds.value.length,
    scrollTop.value,
    viewportHeight.value,
    ROW_HEIGHT,
    8
  );
  return filteredEpisodeIds.value.slice(start, end).map((episodeId, offset) => ({
    episodeId,
    index: start + offset
  }));
});

const collectionTitle = computed(() => (
  activeTheme.value?.title ?? (state.unassignedOnly ? t('unassigned') : t('all'))
));

const selectedTagFilters = computed(() => orderedTagItems(state.tagFilters).map((item) => ({
  ...item,
  category: state.tags.categories.find((category) => category.id === item.categoryId)
})).filter((item) => item.category));

const hasActiveTagFilters = computed(() => selectedTagFilters.value.length > 0);

const canReorder = computed(() => sortMode.value === EPISODE_SORT_MANUAL && !!activeTheme.value && !state.search.trim() && !hasActiveTagFilters.value);
const hasCollectionTags = computed(() => !!Object.keys(activeTheme.value?.tags ?? {}).length);
const localeOptions = computed(() => [
  { label: t('languageEnglish'), value: 'en' },
  { label: t('languageJapanese'), value: 'ja' },
  { label: t('languageChineseSimplified'), value: 'zh-CN' },
  { label: t('languageChineseTraditional'), value: 'zh-TW' }
]);

const tagDialogTitle = computed(() => {
  const title = tagDialogKind.value === 'collection' ? t('editCollectionTags') : t('editEpisodeTags');
  return `${title} · ${tagDialogId.value}`;
});

function collectionPreview(theme) {
  const ids = [...new Set(theme.episodes ?? [])]
    .filter((episodeId) => state.library.episodes[episodeId]?.files?.length);
  return {
    ids: ids.slice(0, COLLECTION_PREVIEW_LIMIT),
    remaining: Math.max(0, ids.length - COLLECTION_PREVIEW_LIMIT)
  };
}

function thumbIndexes(episode) {
  const count = episode?.files?.length ?? 0;
  if (!count) return [];
  return count === 1 ? [0] : [0, count - 1];
}

function resetListScroll() {
  scrollTop.value = 0;
  if (listRef.value) listRef.value.scrollTop = 0;
}

function changeSortMode() {
  dropIndex.value = null;
  resetListScroll();
}

function capturePaneScroll() {
  return {
    collections: collectionListRef.value?.scrollTop ?? 0,
    episodes: listRef.value?.scrollTop ?? scrollTop.value
  };
}

async function restorePaneScroll(position) {
  if (!position) return;
  await nextTick();
  const restore = () => {
    if (collectionListRef.value) collectionListRef.value.scrollTop = position.collections;
    if (listRef.value) listRef.value.scrollTop = position.episodes;
  };
  restore();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  restore();
  scrollTop.value = listRef.value?.scrollTop ?? position.episodes;
}

function removeTagFilter(categoryId, valueId) {
  const values = (state.tagFilters[categoryId] ?? []).filter((value) => value !== valueId);
  if (values.length) state.tagFilters[categoryId] = values;
  else delete state.tagFilters[categoryId];
  resetListScroll();
}

function selectCollection(title = null, unassignedOnly = false) {
  state.selectedThemeTitle = title;
  state.unassignedOnly = unassignedOnly;
  state.selectedEpisodeId = null;
  resetListScroll();
}

function selectCollectionFromClick(title = null, unassignedOnly = false) {
  if (performance.now() < suppressCollectionClickUntil) return;
  selectCollection(title, unassignedOnly);
  if (portraitReaderMode.matches) {
    mobileCollectionOpen.value = true;
    window.history.pushState({ ...(window.history.state ?? {}), mobileCollectionOpen: true }, '');
  }
}

function selectEpisodeFromClick(episodeId) {
  if (performance.now() < suppressEpisodeClickUntil) return;
  if (portraitReaderMode.matches || lastPointerWasTouch.value) {
    openReader(episodeId);
    return;
  }
  state.selectedEpisodeId = episodeId;
}

function markPointerType(event) {
  const isTouch = event.pointerType !== 'mouse';
  touchGesture.value = isTouch;
  lastPointerWasTouch.value = isTouch;
}

function closeMobileCollection() {
  if (window.history.state?.mobileCollectionOpen) window.history.back();
  else mobileCollectionOpen.value = false;
}

function syncMobileNavigation(event) {
  discoveryOpen.value = Boolean(event.state?.discovery);
  mobileCollectionOpen.value = Boolean(event.state?.mobileCollectionOpen);
  if (reader?.isOpen() && !event.state?.readerEpisode) {
    const episodeId = reader.episodeId;
    reader.close();
    focusEpisodeInList(episodeId);
  }
}

function onListScroll(event) {
  const element = event.currentTarget;
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    scrollTop.value = element.scrollTop;
  });
}

function sortedCollectionIds(episodeIds) {
  return sortEpisodeIds(episodeIds, state.library.episodes, sortMode.value);
}

function readerSequence(currentEpisodeId) {
  const theme = (activeTheme.value?.episodes ?? []).includes(currentEpisodeId)
    ? activeTheme.value
    : state.themes.find((candidate) => (candidate.episodes ?? []).includes(currentEpisodeId));
  return sortedCollectionIds(theme?.episodes?.filter((id) => state.library.episodes[id]) ?? episodeIds());
}

function readerCollection(currentEpisodeId) {
  const theme = (activeTheme.value?.episodes ?? []).includes(currentEpisodeId)
    ? activeTheme.value
    : state.themes.find((candidate) => (candidate.episodes ?? []).includes(currentEpisodeId));
  return theme
    ? { title: theme.title, episodes: sortedCollectionIds(theme.episodes.filter((id) => state.library.episodes[id])) }
    : null;
}

function openReader(episodeId, preferredIndex = 0) {
  readerReturnPath = null;
  state.selectedEpisodeId = episodeId;
  if (portraitReaderMode.matches && !window.history.state?.readerEpisode) {
    window.history.pushState({ ...(window.history.state ?? {}), mobileCollectionOpen: true, readerEpisode: episodeId }, '');
  }
  reader?.open(episodeId, preferredIndex);
}

function goTo(path) {
  navigateToPage(path);
}

function openVariantAssignments(episodeId) {
  window.location.assign(variantEpisodePath(episodeId));
}

async function focusEpisodeInList(episodeId) {
  if (!state.library.episodes[episodeId]) return;
  if (!filteredEpisodeIds.value.includes(episodeId)) {
    state.search = '';
    state.tagFilters = {};
    state.dateFilter = { granularity: 'month', start: '', end: '' };
    if (state.unassignedOnly || (activeTheme.value && !activeTheme.value.episodes.includes(episodeId))) selectCollection();
  }
  const index = filteredEpisodeIds.value.indexOf(episodeId);
  if (index < 0) return;
  state.selectedEpisodeId = episodeId;
  if (portraitReaderMode.matches) mobileCollectionOpen.value = true;
  await nextTick();
  const element = listRef.value;
  if (!element) return;
  const top = Math.max(0, index * ROW_HEIGHT - (element.clientHeight - ROW_HEIGHT) / 2);
  element.scrollTop = top;
  scrollTop.value = top;
}

function notify(message, type = 'success') {
  Snackbar[type]({ content: message, position: 'bottom' });
}

async function loadState(announce = false) {
  const payload = await requestJson('/api/state');
  state.library = payload.library ?? state.library;
  state.themes = payload.themes ?? [];
  state.tags = payload.tags ?? state.tags;
  state.recognition = payload.recognition ?? state.recognition;
  state.runtime = payload.runtime ?? state.runtime;
  androidLibraryInitialized.value = Boolean(payload.initialized);
  if (payload.locationError) notify(t('androidLibraryFailed', { message: payload.locationError }), 'warning');
  if (isAndroidApp) {
    setReaderAssetUrlResolver((kind, episodeId, index) => nativeAssetUrl(state.library.episodes[episodeId]?.files?.[index]));
  }
  pruneTagFilters();
  if (state.selectedThemeTitle && !state.themes.some((theme) => theme.title === state.selectedThemeTitle)) {
    state.selectedThemeTitle = null;
  }
  if (announce) notify(t('updatedLibrary'));
}

async function chooseAndroidReadingDirectory() {
  androidImportOpen.value = true;
}

async function importAndroidReadingDirectory() {
  androidImportOpen.value = false;
  pageLoading.value = true;
  try {
    const payload = await chooseAndroidLibrary(copyAndroidLibrary.value);
    if (!payload) return;
    state.library = payload.library ?? state.library;
    state.themes = payload.themes ?? [];
    state.tags = payload.tags ?? state.tags;
    state.runtime = payload.runtime ?? state.runtime;
    androidLibraryInitialized.value = Boolean(payload.initialized);
    setReaderAssetUrlResolver((kind, episodeId, index) => nativeAssetUrl(state.library.episodes[episodeId]?.files?.[index]));
    selectCollection();
  } catch (error) {
    if (!/cancel/i.test(error.message)) notify(t('androidLibraryFailed', { message: error.message }), 'error');
  } finally {
    pageLoading.value = false;
  }
}

async function importJsonFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file || state.busyAction) return;
    state.busyAction = 'importJson';
    try {
      const payload = await requestJson('/api/import/json', { method: 'POST', body: await file.text() });
      await loadState();
      notify(payload.missingCount ? t('importJsonWarning', { count: payload.missingCount }) : t('importJsonDone'), payload.missingCount ? 'warning' : 'success');
    } catch (error) {
      notify(t('importJsonFailed', { message: error.message }), 'error');
    } finally {
      state.busyAction = null;
    }
  }, { once: true });
  input.click();
}

function openRecognitionDialog() {
  const source = cloneData(state.recognition);
  recognitionDraft.version = 1;
  recognitionDraft.rules = source.rules ?? [];
  recognitionDraft.episodeDates = source.episodeDates ?? {};
  recognitionDraft.identityMarkers = source.identityMarkers ?? [];
  recognitionDialogOpen.value = true;
}

function addRecognitionRule() {
  recognitionDraft.rules.push({ id: `rule-${Date.now()}`, prefix: '', suffix: '' });
}

async function saveRecognitionRules() {
  try {
    await requestJson('/api/recognition', { method: 'PUT', body: JSON.stringify(cloneData(recognitionDraft)) });
    await loadState();
    notify(t('recognitionSaved'));
  } catch (error) {
    notify(t('saveFailed', { message: error.message }), 'error');
  }
}

async function saveEpisodeDate(episodeId, date) {
  if (state.busyAction) return;
  const action = `episodeDate:${episodeId}`;
  state.busyAction = action;
  const episodeDates = { ...(state.recognition.episodeDates ?? {}) };
  if (date) episodeDates[episodeId] = date;
  else delete episodeDates[episodeId];
  try {
    await requestJson('/api/recognition', {
      method: 'PUT',
      body: JSON.stringify({ ...cloneData(state.recognition), episodeDates })
    });
    await loadState();
    notify(t('episodeDateSaved'));
  } catch (error) {
    notify(t('saveFailed', { message: error.message }), 'error');
  } finally {
    state.busyAction = null;
  }
}

function downloadJsonExport(payload) {
  downloadJsonFile(payload.export, `ATP-Comic-export-${new Date().toISOString().slice(0, 10)}.json`);
}

async function runAction(name, endpoint, onSuccess = null) {
  if (state.busyAction) return;
  state.busyAction = name;
  const labels = {
    scan: [t('scanningPending'), t('scanDone'), t('scanFailed')],
    exportJson: [t('exportingJsonPending'), t('exportJsonDone'), t('exportFailed')],
    exportReading: [t('exportingReadingPending'), t('exportReadingDone'), t('exportFailed')]
  }[name];
  Snackbar.loading({ content: labels[0], position: 'bottom', duration: 0 });
  try {
    const payload = await requestJson(endpoint, { method: 'POST', body: '{}' });
    if (onSuccess) onSuccess(payload);
    await loadState();
    Snackbar.clear();
    notify(labels[1]);
  } catch (error) {
    Snackbar.clear();
    notify(`${labels[2]}: ${error.message}`, 'error');
  } finally {
    state.busyAction = null;
  }
}

async function persistTheme(theme, episodes, { preserveScroll = true, successMessage = t('savedArrangement') } = {}) {
  if (!theme) return;
  const paneScroll = preserveScroll ? capturePaneScroll() : null;
  try {
    await requestJson('/api/themes', {
      method: 'POST',
      body: JSON.stringify({ title: theme.title, episodes, tags: theme.tags ?? {} })
    });
    await loadState();
    await restorePaneScroll(paneScroll);
    if (successMessage) notify(successMessage);
  } catch (error) {
    notify(t('saveFailed', { message: error.message }), 'error');
  }
}

function openNameDialog(mode) {
  nameDialogMode.value = mode;
  nameDraft.value = mode === 'rename' ? activeTheme.value?.title ?? '' : '';
  nameDialogOpen.value = true;
}

async function saveNameDialog() {
  const title = nameDraft.value.trim();
  if (!title) return;
  try {
    if (nameDialogMode.value === 'create') {
      await requestJson('/api/themes', {
        method: 'POST',
        body: JSON.stringify({ title, episodes: [] })
      });
    } else if (activeTheme.value && title !== activeTheme.value.title) {
      await requestJson(`/api/themes/${encodeURIComponent(activeTheme.value.title)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title })
      });
    }
    if (nameDialogMode.value === 'rename') state.selectedThemeTitle = title;
    await loadState();
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function deleteTheme() {
  const theme = activeTheme.value;
  if (!theme) return;
  const action = await Dialog({
    title: t('deleteCollection'),
    message: t('deleteCollectionConfirm', { title: theme.title }),
    cancelButton: true,
    confirmButtonText: t('deleteCollection')
  });
  if (action !== 'confirm') return;
  await requestJson(`/api/themes/${encodeURIComponent(theme.title)}`, { method: 'DELETE' });
  selectCollection();
  await loadState();
}

function onDragStart(episodeId, event) {
  if (touchUi.value || touchGesture.value) { event.preventDefault(); onDragEnd(); return; }
  state.draggedEpisodeId = episodeId;
  dropIndex.value = null;
  event.dataTransfer?.clearData();
  event.dataTransfer?.setData(EPISODE_DRAG_TYPE, episodeId);
  event.dataTransfer?.setData('text/plain', episodeId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove';
}

function onDragEnd() {
  if (state.draggedEpisodeId) suppressEpisodeClickUntil = performance.now() + 250;
  state.draggedEpisodeId = null;
  dropIndex.value = null;
  dropThemeTitle.value = null;
}

function onThemeDragOver(theme, event) {
  if (!state.draggedEpisodeId) return;
  autoScrollCollectionList(event);
  const alreadyAssigned = (theme.episodes ?? []).includes(state.draggedEpisodeId);
  dropThemeTitle.value = alreadyAssigned ? null : theme.title;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = alreadyAssigned ? 'none' : 'copy';
  }
}

function autoScrollCollectionList(event) {
  const element = collectionListRef.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const edge = Math.min(64, rect.height / 4);
  if (event.clientY < rect.top + edge) {
    element.scrollTop -= Math.max(8, (rect.top + edge - event.clientY) * 0.32);
  } else if (event.clientY > rect.bottom - edge) {
    element.scrollTop += Math.max(8, (event.clientY - (rect.bottom - edge)) * 0.32);
  }
}

function onThemeDragLeave(theme, event) {
  if (dropThemeTitle.value !== theme.title) return;
  if (event.relatedTarget && event.currentTarget?.contains(event.relatedTarget)) return;
  dropThemeTitle.value = null;
}

function episodeRows() {
  return [...(listRef.value?.querySelectorAll('.episode-row[data-episode-index]') ?? [])].map((row) => {
    const rect = row.getBoundingClientRect();
    return { index: Number(row.dataset.episodeIndex), top: rect.top, height: rect.height };
  });
}

function onListDragOver(event) {
  if (!canReorder.value || !state.draggedEpisodeId || !listRef.value) return;
  const rect = listRef.value.getBoundingClientRect();
  const edge = Math.min(64, rect.height / 4);
  if (event.clientY < rect.top + edge) {
    listRef.value.scrollTop -= Math.max(8, (rect.top + edge - event.clientY) * 0.32);
  } else if (event.clientY > rect.bottom - edge) {
    listRef.value.scrollTop += Math.max(8, (event.clientY - (rect.bottom - edge)) * 0.32);
  }
  scrollTop.value = listRef.value.scrollTop;
  dropIndex.value = rowInsertionIndex(episodeRows(), event.clientY, filteredEpisodeIds.value.length);
}

async function dropAtIndex(event) {
  if (!canReorder.value || dropIndex.value == null) return;
  const theme = activeTheme.value;
  const dragged = draggedEpisodeId(event.dataTransfer, state.draggedEpisodeId, state.library.episodes);
  if (!theme || !dragged) return;
  const originalIndex = theme.episodes.indexOf(dragged);
  if (originalIndex < 0) return;
  const next = moveItemToSlot(theme.episodes, dragged, dropIndex.value);
  onDragEnd();
  if (next.every((id, index) => id === theme.episodes[index])) return;
  await persistTheme(theme, next);
}

async function dropOnTheme(theme, event) {
  const episodeId = draggedEpisodeId(event.dataTransfer, state.draggedEpisodeId, state.library.episodes);
  event.stopPropagation();
  suppressCollectionClickUntil = performance.now() + 300;
  onDragEnd();
  if (!episodeId || (theme.episodes ?? []).includes(episodeId)) return;
  await persistTheme(theme, [...(theme.episodes ?? []), episodeId], {
    successMessage: t('episodeAddedToCollection', { episode: episodeId, collection: theme.title })
  });
}

function openTagAssignment(kind, id) {
  tagDialogKind.value = kind;
  tagDialogId.value = id;
  const source = kind === 'collection'
    ? activeTheme.value?.tags ?? {}
    : state.tags.episodeTags[id] ?? {};
  for (const key of Object.keys(tagDraftSelection)) delete tagDraftSelection[key];
  Object.assign(tagDraftSelection, cloneData(source));
  tagDialogOpen.value = true;
}

function setDraftTagSelection(categoryId, values) {
  tagDraftSelection[categoryId] = Array.isArray(values) ? [...new Set(values)] : [];
}

async function saveTagDialog() {
  try {
    if (tagDialogKind.value === 'collection' && activeTheme.value) {
      await requestJson('/api/themes', {
        method: 'POST',
        body: JSON.stringify({ ...activeTheme.value, tags: cloneData(tagDraftSelection) })
      });
    } else {
      const episodeTags = {
        ...state.tags.episodeTags,
        [tagDialogId.value]: cloneData(tagDraftSelection)
      };
      await requestJson('/api/tags', {
        method: 'PUT',
        body: JSON.stringify({ ...state.tags, episodeTags })
      });
    }
    await loadState();
    notify(t('savedTags'));
  } catch (error) {
    notify(t('saveTagsFailed', { message: error.message }), 'error');
  }
}

async function applyCollectionTags() {
  const theme = activeTheme.value;
  if (!theme) return;
  if (!Object.keys(theme.tags ?? {}).length) {
    notify(t('collectionNoTags'), 'warning');
    return;
  }
  try {
    const episodeTags = { ...state.tags.episodeTags };
    for (const episodeId of theme.episodes ?? []) {
      episodeTags[episodeId] = mergeTagMaps(episodeTags[episodeId], theme.tags);
    }
    await requestJson('/api/tags', {
      method: 'PUT',
      body: JSON.stringify({ ...state.tags, episodeTags })
    });
    await loadState();
    notify(t('appliedTags', { name: theme.title, count: theme.episodes?.length ?? 0 }));
  } catch (error) {
    notify(t('saveTagsFailed', { message: error.message }), 'error');
  }
}

function openReaderSettings() {
  Object.assign(settingsDraft, reader.getReaderSettings());
  settingsDialogOpen.value = true;
}

function saveReaderSettings() {
  const settings = reader.setReaderSettings(settingsDraft);
  localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
  Object.assign(settingsDraft, settings);
  notify(t('savedReaderSettings'));
}

function changeLocale(value) {
  localStorage.setItem(pagesLocalStorageKey(import.meta.env.BASE_URL, 'comic-manager.locale'), value);
  window.location.reload();
}

function controlReaderWindow(action) {
  if (action === 'restore') {
    void reader?.toggleFullscreen();
    return;
  }
  window.atpDesktop?.controlWindow?.(action);
}

const pageLoading = ref(true);
onMounted(async () => {
  document.title = t('appTitle');
  document.documentElement.lang = locale;
  window.history.replaceState({ ...(window.history.state ?? {}), mobileCollectionOpen: false }, '');
  window.addEventListener('popstate', syncMobileNavigation);
  reader = new ComicReader(readerRoot.value, {
    getEpisode: (episodeId) => state.library.episodes[episodeId],
    getSequence: readerSequence,
    getCollection: readerCollection,
    settings: loadReaderSettings(),
    onPageProgress: (progress) => pageSliderRef.value?.setState(progress),
    onCollectionProgress: (progress) => episodeSliderRef.value?.setState(progress),
    onVariants: (variants) => readerVariantsRef.value?.setState(variants),
    onEditEpisodeTags: (episodeId) => openTagAssignment('episode', episodeId),
    onClose: () => {
      focusEpisodeInList(reader.episodeId);
      if (portraitReaderMode.matches && window.history.state?.readerEpisode) {
        window.history.back();
        return true;
      }
      if (!readerReturnPath) return false;
      const target = readerReturnPath;
      readerReturnPath = null;
      reader.close();
      window.location.assign(target);
      return true;
    }
  });
  resizeObserver = new ResizeObserver(([entry]) => {
    viewportHeight.value = entry.contentRect.height || 650;
  });
  resizeObserver.observe(listRef.value);
  try {
    await loadState();
    pageLoading.value = false;
    await nextTick();
    const focusedEpisode = pendingFocusedEpisodeId;
    pendingFocusedEpisodeId = null;
    if (focusedEpisode && state.library.episodes[focusedEpisode]) {
      await focusEpisodeInList(focusedEpisode);
      const url = new URL(window.location.href);
      url.searchParams.delete('focus');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    const initialEpisode = pendingInitialEpisodeId;
    pendingInitialEpisodeId = null;
    if (initialEpisode && state.library.episodes[initialEpisode]) {
      state.selectedEpisodeId = initialEpisode;
      await nextTick();
      reader.open(initialEpisode);
      const url = new URL(window.location.href);
      url.searchParams.delete('episode');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch (error) {
    notify(t('initFailed', { message: error.message }), 'error');
  } finally {
    pageLoading.value = false;
  }
});

function refreshPagesLibrary() { loadState().catch(error => notify(error.message, 'error')); }
onMounted(() => window.addEventListener('pages-library-changed', refreshPagesLibrary));
onBeforeUnmount(() => {
  window.removeEventListener('pages-library-changed', refreshPagesLibrary);
  resizeObserver?.disconnect();
  cancelAnimationFrame(scrollFrame);
  window.removeEventListener('popstate', syncMobileNavigation);
});
</script>

<template>
  <PagesAccessBanner v-if="isPagesApp" />
  <var-dialog v-model:show="androidImportOpen" :title="t('chooseReadingDirectory')" :cancel-button="true" @confirm="importAndroidReadingDirectory">
    <var-switch v-model="copyAndroidLibrary">{{ t('copyLibraryToApp') }}</var-switch>
    <p>{{ t('copyLibraryToAppNote') }}</p>
  </var-dialog>
  <div class="app-shell" :class="{ 'discovery-active': discoveryOpen, 'touch-header-hidden': touchUi && headerHidden }" @scroll.capture.passive="onPageScroll">
    <AppTopBar
      :busy-action="state.busyAction"
      :issue-count="state.library.warnings.length"
      :library-location="state.runtime.workspaceRoot"
      :locale-options="localeOptions"
      :selected-locale="selectedLocale"
      @scan="runAction('scan', '/api/scan')"
      @export-json="runAction('exportJson', '/api/export/json', downloadJsonExport)"
      @export-reading="runAction('exportReading', '/api/apply')"
      @import-json="importJsonFile"
      @issues="goTo('/warnings.html')"
      @recognition="openRecognitionDialog"
      @tags="goTo('/tags.html')"
      @variants="goTo('/variants.html')"
      @change-locale="changeLocale"
      @pages-imported="loadState()"
    />

    <DiscoveryFeed v-if="discoveryOpen" :loading="pageLoading" :library="state.library" :tags="state.tags" :category-style="tagCategoryStyle" :episode-label="episodeLabel" @close="closeDiscovery" @read="openReader($event.episodeId, $event.index)" />
    <main v-show="!discoveryOpen" class="workspace-grid" :class="{ 'mobile-collection-open': mobileCollectionOpen }">
      <var-card class="collection-pane" elevation="0">
        <header class="pane-heading">
          <h2>{{ t('collections') }}</h2>
          <div class="pane-heading-actions">
            <var-button text round :aria-label="pagesText('reverse')" :title="pagesText('reverse')" :aria-pressed="reverseCollections" @click="reverseCollections = !reverseCollections"><MdiIcon :path="mdiArrowDown" :style="{ transform: reverseCollections ? 'rotate(180deg)' : '' }" /></var-button>
            <span v-if="isPagesApp" class="pane-heading-library"><PagesLibraryControl @imported="loadState()" @recognition="openRecognitionDialog" /></span>
            <span class="mobile-settings"><SettingsMenu v-model="selectedLocale" :options="localeOptions" @change="changeLocale" /></span>
            <var-button v-if="isAndroidApp" class="android-library-change" round text :aria-label="t('chooseReadingDirectory')" :title="t('chooseReadingDirectory')" @click="chooseAndroidReadingDirectory"><MdiIcon :path="mdiFolderOpenOutline" /></var-button>
          </div>
        </header>
        <div ref="collectionListRef" class="collection-list">
          <section v-if="isAndroidApp && !androidLibraryInitialized" class="android-library-prompt">
            <MdiIcon :path="mdiFolderOpenOutline" size="34" />
            <strong>{{ t('androidLibraryPrompt') }}</strong>
            <span>{{ t('androidLibrarySupporting') }}</span>
            <var-button type="primary" @click="chooseAndroidReadingDirectory">{{ t('chooseReadingDirectory') }}</var-button>
          </section>
          <div v-if="!isAndroidApp || androidLibraryInitialized" class="collection-system-items">
            <var-button block text class="collection-item" @click="openDiscovery"><MdiIcon :path="mdiShuffleVariant" /><span class="collection-copy"><strong>{{ t('discover') }}</strong></span></var-button>
            <var-button
              block
              text
              class="collection-item"
              :class="{ active: !state.selectedThemeTitle && !state.unassignedOnly }"
              @click="selectCollectionFromClick()"
            >
              <MdiIcon :path="mdiBookMultipleOutline" />
              <span class="collection-copy"><strong>{{ t('all') }}</strong></span>
              <var-badge class="collection-count" :value="episodeIds().length" :max-value="999" :type="!state.selectedThemeTitle && !state.unassignedOnly ? 'primary' : 'info'" />
            </var-button>
            <var-button
              block
              text
              class="collection-item"
              :class="{ active: !state.selectedThemeTitle && state.unassignedOnly }"
              @click="selectCollectionFromClick(null, true)"
            >
              <MdiIcon :path="mdiInboxOutline" />
              <span class="collection-copy"><strong>{{ t('unassigned') }}</strong></span>
              <var-badge class="collection-count" :value="unassignedEpisodeIds.length" :max-value="999" :type="!state.selectedThemeTitle && state.unassignedOnly ? 'primary' : 'info'" />
            </var-button>
          </div>
          <PageSkeleton v-if="pageLoading" />
          <var-button
            v-for="theme in displayedThemes"
            :key="theme.title"
            block
            text
            class="collection-item"
            :class="{ active: state.selectedThemeTitle === theme.title, 'drop-target': dropThemeTitle === theme.title }"
            @click="selectCollectionFromClick(theme.title)"
            @dragover.stop.prevent="onThemeDragOver(theme, $event)"
            @dragleave="onThemeDragLeave(theme, $event)"
            @drop.stop.prevent="dropOnTheme(theme, $event)"
          >
            <span class="collection-copy">
              <strong>{{ theme.title }}</strong>
              <small>{{ flattenTags(theme.tags).join(' · ') || t('noTags') }}</small>
            </span>
            <var-badge class="collection-count" :value="theme.episodes?.length ?? 0" :max-value="999" :type="state.selectedThemeTitle === theme.title ? 'primary' : 'info'" />
            <span v-if="collectionPreview(theme).ids.length" class="collection-preview" aria-hidden="true">
              <img
                v-for="episodeId in collectionPreview(theme).ids"
                :key="episodeId"
                :src="getThumbnailUrl(episodeId, 0, state.library.episodes[episodeId]?.files[0]?.assetKey)"
                alt=""
                loading="lazy"
                decoding="async"
              >
              <var-badge v-if="collectionPreview(theme).remaining" class="collection-preview-more" :value="collectionPreview(theme).remaining" :max-value="99" type="info" />
            </span>
          </var-button>
        </div>
        <var-fab class="collection-create-fab" :fixed="false" position="right-bottom" :teleport="false" :bottom="20" :right="20" @click="openNameDialog('create')">
          <template #trigger>
            <var-button class="md3-fab" type="primary" icon-container :aria-label="t('newCollection')" :title="t('newCollection')"><MdiIcon :path="mdiPlus" /></var-button>
          </template>
        </var-fab>
      </var-card>

      <var-card class="episodes-pane" elevation="0">
        <header class="pane-heading episode-heading">
          <var-button class="mobile-pane-back" round text :aria-label="t('back')" @click="closeMobileCollection"><MdiIcon :path="mdiChevronLeft" /></var-button>
          <div class="episode-heading-title"><span class="overline">{{ t('episodesOverline') }}</span><h2>{{ collectionTitle }}</h2></div>
          <var-badge class="episode-total" :value="filteredEpisodeIds.length" :max-value="9999" type="info" />
          <div class="episode-heading-actions">
            <var-button-group v-if="activeTheme" mode="outline" size="small" :elevation="false" class="collection-actions">
              <var-button outline :title="t('editCollectionTags')" :aria-label="t('editCollectionTags')" @click="openTagAssignment('collection', activeTheme.title)"><MdiIcon :path="mdiTagOutline" /></var-button>
              <var-button outline :class="{ 'is-muted-action': !hasCollectionTags }" :title="hasCollectionTags ? t('applyCollectionTags') : t('collectionNoTags')" :aria-label="t('applyCollectionTags')" @click="applyCollectionTags"><MdiIcon :path="mdiTagArrowDownOutline" /></var-button>
              <var-button outline :title="t('renameCollection')" :aria-label="t('renameCollection')" @click="openNameDialog('rename')"><MdiIcon :path="mdiPencilOutline" /></var-button>
              <var-button outline class="danger-action" :title="t('deleteCollection')" :aria-label="t('deleteCollection')" @click="deleteTheme"><MdiIcon :path="mdiDeleteOutline" /></var-button>
            </var-button-group>
          </div>
        </header>

        <div v-if="activeTheme" class="collection-tag-row">
          <TagDisplayChip
            v-for="tag in orderedTagItems(activeTheme.tags)"
            :key="tag.key"
            :path="tag.path"
            :fallback="String(tag.valueId)"
            :style="tagCategoryStyle(tag.categoryId)"
          />
          <span v-if="!orderedTagItems(activeTheme.tags).length" class="muted">{{ t('collectionNoTags') }}</span>
        </div>

        <div class="filter-row">
          <var-input v-model="state.search" class="compact-input query-search" size="small" variant="outlined" clearable :is-show-form-details="false" :placeholder="t('searchPlaceholder')" @input="resetListScroll">
            <template #prepend-icon><MdiIcon :path="mdiMagnify" /></template>
          </var-input>
          <TagFilterControl
            v-model="state.tagFilters"
            :categories="state.tags.categories"
            :category-style="tagCategoryStyle"
            :counts="tagEpisodeCounts"
            @change="resetListScroll"
          />
          <DateFilterControl v-model="state.dateFilter" @change="resetListScroll" />
          <SortControl v-model="effectiveSortMode" :manual-available="!!activeTheme" @change="changeSortMode" />
        </div>
        <div v-if="selectedTagFilters.length" class="active-tag-filters" :aria-label="t('activeTagFilters')">
          <TagDisplayChip
            v-for="filter in selectedTagFilters"
            :key="filter.key"
            :path="filter.path"
            :fallback="String(filter.valueId)"
            :style="tagCategoryStyle(filter.categoryId)"
            closeable
            @close="removeTagFilter(filter.category.id, filter.valueId)"
          />
        </div>

        <div ref="listRef" class="episode-scroll" :class="{ reordering: canReorder && state.draggedEpisodeId }" @scroll="onListScroll" @dragover.prevent="onListDragOver" @drop.prevent="dropAtIndex">
          <PageSkeleton v-if="pageLoading" />
          <div v-if="filteredEpisodeIds.length" class="virtual-canvas" :style="{ height: `${filteredEpisodeIds.length * ROW_HEIGHT + (canReorder ? 22 : 0)}px` }">
            <div v-if="canReorder && state.draggedEpisodeId && dropIndex != null" class="episode-insert-line" :style="{ top: `${dropIndex * ROW_HEIGHT}px` }"></div>
            <article
              v-for="row in visibleRows"
              :key="row.episodeId"
              v-ripple
              class="episode-row"
              :class="{ ordered: !!activeTheme, selected: state.selectedEpisodeId === row.episodeId, dragging: state.draggedEpisodeId === row.episodeId }"
              :data-episode-index="row.index"
              :style="{ transform: `translateY(${row.index * ROW_HEIGHT}px)` }"
              :draggable="!touchUi && !touchGesture"
              @pointerdown="markPointerType($event)"
              @pointerup="touchGesture = false"
              @pointercancel="touchGesture = false"
              @contextmenu="touchUi || touchGesture ? $event.preventDefault() : undefined"
              @click="selectEpisodeFromClick(row.episodeId)"
              @dblclick="openReader(row.episodeId)"
              @dragstart="onDragStart(row.episodeId, $event)"
              @dragend="onDragEnd"
            >
              <MdiIcon class="drag-handle" :path="mdiDragVertical" :title="t('dragToCollection')" />
              <span v-if="activeTheme" class="order-number">{{ String(row.index + 1).padStart(3, '0') }}</span>
              <div class="thumb-pair">
                <template v-if="thumbIndexes(state.library.episodes[row.episodeId]).length">
                  <img
                    v-for="index in thumbIndexes(state.library.episodes[row.episodeId])"
                    :key="index"
                    :src="getThumbnailUrl(row.episodeId, index, state.library.episodes[row.episodeId]?.files[index]?.assetKey)"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable="false"
                  >
                </template>
                <span v-else class="thumb-empty">{{ t('noImage') }}</span>
              </div>
              <div class="episode-copy">
                <div class="episode-title">
                  <strong>{{ episodeLabel(row.episodeId) }}</strong>
                  <span v-if="state.library.episodes[row.episodeId]?.date" class="episode-date">{{ state.library.episodes[row.episodeId].date }}</span>
                </div>
                <div class="episode-meta">
                  <span>{{ t('items', { count: state.library.episodes[row.episodeId]?.files?.length ?? 0 }) }}</span>
                  <span>{{ layoutLabel(state.library.episodes[row.episodeId]?.layout) }}</span>
                  <span v-if="warningsForEpisode(row.episodeId).length" class="warning">{{ t('issueCount', { count: warningsForEpisode(row.episodeId).length }) }}</span>
                </div>
                <div class="episode-supporting">
                  <span v-if="!activeTheme && themesForEpisode(row.episodeId).length" class="episode-themes">{{ themesForEpisode(row.episodeId).join(' / ') }}</span>
                  <span class="episode-tags">
                    <TagDisplayChip
                      v-for="tag in orderedTagItems(state.tags.episodeTags[row.episodeId])"
                      :key="tag.key"
                      :path="tag.path"
                      :fallback="String(tag.valueId)"
                      :style="tagCategoryStyle(tag.categoryId)"
                      size="small"
                    />
                    <span v-if="!orderedTagItems(state.tags.episodeTags[row.episodeId]).length" class="muted">{{ t('noTags') }}</span>
                  </span>
                </div>
              </div>
              <div class="episode-actions">
                <var-button round text :aria-label="t('editEpisodeTags')" @click.stop="openTagAssignment('episode', row.episodeId)"><MdiIcon :path="mdiTagOutline" /></var-button>
                <EpisodeDateControl
                  v-if="state.library.episodes[row.episodeId]?.layout === 'rule-folder'"
                  :model-value="state.library.episodes[row.episodeId]?.date ?? ''"
                  :busy="state.busyAction === `episodeDate:${row.episodeId}`"
                  @save="saveEpisodeDate(row.episodeId, $event)"
                />
                <var-button round text :aria-label="t('editEpisodeVariants')" :title="t('editEpisodeVariants')" @click.stop="openVariantAssignments(row.episodeId)"><MdiIcon :path="mdiTuneVariant" /></var-button>
                <var-button round text type="primary" :aria-label="t('readEpisode')" @click.stop="openReader(row.episodeId)"><MdiIcon :path="mdiBookOpenPageVariantOutline" /></var-button>
                <var-button v-if="activeTheme" round text class="danger-action" :aria-label="t('removeFromCollection')" @click.stop="persistTheme(activeTheme, activeTheme.episodes.filter((id) => id !== row.episodeId))"><MdiIcon :path="mdiDeleteOutline" /></var-button>
              </div>
            </article>
          </div>
          <div v-else-if="!pageLoading" class="empty-state">{{ t('noResults') }}</div>
        </div>
      </var-card>
    </main>

    <var-dialog
      v-model:show="recognitionDialogOpen"
      width="min(760px, calc(100vw - 32px))"
      :title="t('recognitionRules')"
      :confirm-button-text="t('save')"
      :cancel-button-text="t('cancel')"
      cancel-button
      @confirm="saveRecognitionRules"
    >
      <div class="recognition-editor">
        <p class="dialog-note">{{ t('recognitionRulesHelp') }}</p>
        <div v-for="(rule, index) in recognitionDraft.rules" :key="rule.id" class="recognition-rule-row">
          <var-input v-model="rule.prefix" size="small" variant="outlined" :is-show-form-details="false" :placeholder="t('folderPrefix')" />
          <var-input v-model="rule.suffix" size="small" variant="outlined" :is-show-form-details="false" :placeholder="t('folderSuffix')" />
          <var-button round text class="danger-action" :aria-label="t('deleteRecognitionRule')" @click="recognitionDraft.rules.splice(index, 1)"><MdiIcon :path="mdiDeleteOutline" /></var-button>
        </div>
        <var-button size="small" text @click="addRecognitionRule"><MdiIcon :path="mdiPlus" />{{ t('addRecognitionRule') }}</var-button>
        <h3 class="recognition-section-title">{{ t('filenameMarkers') }}</h3>
        <p class="dialog-note">{{ t('filenameMarkersHelp') }}</p>
        <div v-for="(_, index) in recognitionDraft.identityMarkers" :key="index" class="filename-marker-row">
          <var-input v-model="recognitionDraft.identityMarkers[index]" size="small" variant="outlined" :is-show-form-details="false" :placeholder="t('filenameMarker')" />
          <var-button round text class="danger-action" :aria-label="t('deleteFilenameMarker')" @click="recognitionDraft.identityMarkers.splice(index, 1)"><MdiIcon :path="mdiDeleteOutline" /></var-button>
        </div>
        <var-button size="small" text :disabled="recognitionDraft.identityMarkers.length >= 100" @click="recognitionDraft.identityMarkers.push('')"><MdiIcon :path="mdiPlus" />{{ t('addFilenameMarker') }}</var-button>
        <p class="dialog-note">{{ t('filenameMarkersRescan') }}</p>
      </div>
    </var-dialog>

    <var-dialog
      v-model:show="nameDialogOpen"
      :title="nameDialogMode === 'create' ? t('newCollection') : t('renameCollection')"
      :confirm-button-text="t('save')"
      :cancel-button-text="t('cancel')"
      cancel-button
      @confirm="saveNameDialog"
    >
      <var-input v-model="nameDraft" class="compact-input" size="small" variant="outlined" autofocus :is-show-form-details="false" :placeholder="t('collectionTitlePrompt')" />
    </var-dialog>

    <var-dialog
      v-model:show="tagDialogOpen"
      width="min(760px, calc(100vw - 32px))"
      :title="tagDialogTitle"
      :confirm-button-text="t('save')"
      :cancel-button-text="t('cancel')"
      cancel-button
      @confirm="saveTagDialog"
    >
      <div class="tag-assignment">
        <p v-if="!state.tags.categories.length" class="dialog-note">{{ t('emptyTagSystem') }}</p>
        <section v-for="category in state.tags.categories" :key="category.id" class="assignment-category" :style="tagCategoryStyle(category)">
          <h3><span v-if="category.emoji" class="tag-emoji">{{ category.emoji }}</span>{{ category.name }}</h3>
          <TagAssignmentPicker
            v-if="categoryTagEntries(category).length"
            :nodes="category.values"
            :model-value="tagDraftSelection[category.id] ?? []"
            :category-style="tagCategoryStyle(category)"
            @update:model-value="setDraftTagSelection(category.id, $event)"
          />
          <span v-else class="muted">{{ t('emptyCategory') }}</span>
        </section>
      </div>
    </var-dialog>

    <var-dialog
      v-model:show="settingsDialogOpen"
      :title="t('readerSettings')"
      :confirm-button-text="t('save')"
      :cancel-button-text="t('cancel')"
      cancel-button
      @confirm="saveReaderSettings"
    >
      <div class="settings-grid reader-settings">
        <div class="settings-field">
          <span class="settings-label">{{ t('readerMode') }}</span>
          <var-segmented-buttons :model-value="settingsDraft.mode" :options="readerModeOptions" :checkmark="false" size="small" @update:model-value="settingsDraft.mode = $event" />
        </div>
        <div class="settings-field">
          <span class="settings-label">{{ t('readingOrder') }}</span>
          <var-segmented-buttons :model-value="settingsDraft.order" :options="readerOrderOptions" :checkmark="false" size="small" @update:model-value="settingsDraft.order = $event" />
        </div>
        <div v-if="settingsDraft.mode === 'continuous'" class="settings-field">
          <span class="settings-label">{{ t('pageFit') }}</span>
          <var-segmented-buttons :model-value="settingsDraft.fit" :options="readerFitOptions" :checkmark="false" size="small" @update:model-value="settingsDraft.fit = $event" />
          <small>{{ t('pageFitHelp') }}</small>
        </div>
        <div class="settings-field settings-switch">
          <span class="settings-label">{{ t('pageAnimation') }}</span>
          <var-switch v-model="settingsDraft.pageAnimation" />
          <small>{{ t('pageAnimationHelp') }}</small>
        </div>
        <div class="settings-field settings-switch">
          <span class="settings-label">{{ t('focusDim') }}</span>
          <var-switch v-model="settingsDraft.focusDim" />
          <small>{{ t('focusDimHelp') }}</small>
        </div>
        <div class="settings-divider">{{ t('peekSettings') }}</div>
        <div class="settings-field">
          <var-input v-model="settingsDraft.radius" class="compact-input" type="number" size="small" variant="outlined" :is-show-form-details="false" :placeholder="t('defaultRadius')" />
          <small>{{ t('radiusHelp') }}</small>
        </div>
        <div class="settings-field">
          <var-input v-model="settingsDraft.feather" class="compact-input" type="number" size="small" variant="outlined" :is-show-form-details="false" :placeholder="t('feather')" />
          <small>{{ t('featherHelp') }}</small>
        </div>
        <div class="settings-field">
          <var-input v-model="settingsDraft.animationSpeed" class="compact-input" type="number" size="small" variant="outlined" :is-show-form-details="false" :placeholder="t('animationSpeed')" />
          <small>{{ t('speedHelp') }}</small>
        </div>
      </div>
    </var-dialog>

    <section v-once ref="readerRoot" class="reader" hidden :aria-label="t('readEpisode')">
      <header class="reader-bar">
        <div class="reader-leading">
          <var-button round text data-reader-close :aria-label="t('back')"><MdiIcon :path="mdiChevronLeft" /></var-button>
          <div class="reader-heading">
            <nav class="reader-breadcrumb" :aria-label="t('readerLocation')">
              <span data-reader-collection hidden></span>
              <MdiIcon data-reader-breadcrumb-separator hidden :path="mdiChevronRight" size="16" />
              <strong data-reader-title></strong>
            </nav>
            <span class="reader-meta" data-reader-meta></span>
          </div>
        </div>
        <ReaderVariants
          ref="readerVariantsRef"
          @select="reader?.switchVariant($event)"
          @peek-target="reader?.setPeekTarget($event)"
        >
          <template #left>
            <div class="reader-peek-controls">
              <var-button size="small" text data-reader-peek-toggle class="reader-text-action is-active"><MdiIcon :path="mdiSelectionEllipse" />{{ t('peek') }}</var-button>
              <var-button size="small" round text data-reader-settings :aria-label="t('readerSettings')" @click="openReaderSettings"><MdiIcon :path="mdiCogOutline" /></var-button>
            </div>
          </template>
        </ReaderVariants>
        <div class="reader-tools">
          <var-button round text data-reader-zoom-out :aria-label="t('zoomOut')"><MdiIcon :path="mdiMagnifyMinusOutline" /></var-button>
          <var-button size="small" text class="reader-text-action" data-reader-fit><MdiIcon :path="mdiImageOutline" />{{ t('fit') }}</var-button>
          <var-button round text data-reader-zoom-in :aria-label="t('zoomIn')"><MdiIcon :path="mdiMagnifyPlusOutline" /></var-button>
          <ReaderHelp :label="t('readerHelp')" :text="t('readerHint')" />
          <var-button round text data-reader-fullscreen :aria-label="t('fullscreen')"><MdiIcon :path="mdiFullscreen" /></var-button>
          <div v-if="desktopWindowControls" class="reader-window-controls">
            <button type="button" :aria-label="t('minimizeWindow')" :title="t('minimizeWindow')" @click="controlReaderWindow('minimize')"><MdiIcon :path="mdiWindowMinimize" size="16" /></button>
            <button type="button" :aria-label="t('restoreWindow')" :title="t('restoreWindow')" @click="controlReaderWindow('restore')"><MdiIcon :path="mdiWindowRestore" size="15" /></button>
            <button type="button" class="reader-window-close" :aria-label="t('closeWindow')" :title="t('closeWindow')" @click="controlReaderWindow('close')"><MdiIcon :path="mdiWindowClose" size="16" /></button>
          </div>
        </div>
      </header>
      <div class="reader-stage">
        <ReaderSlider ref="episodeSliderRef" class="reader-episode-progress" :icon-path="mdiBookMultipleOutline" :aria-label="t('episodeProgress')" hidden @input="reader?.openCollectionEpisode($event - 1)" />
        <div class="reader-viewport" data-reader-viewport>
          <div class="reader-plane" data-reader-plane></div>
          <span class="reader-edge-cue reader-edge-prev" aria-hidden="true"><MdiIcon :path="mdiChevronLeft" size="32" /></span>
          <span class="reader-edge-cue reader-edge-next" aria-hidden="true"><MdiIcon :path="mdiChevronRight" size="32" /></span>
          <var-fab class="reader-tag-fab" :fixed="false" position="right-bottom" :teleport="false" :bottom="22" :right="22">
            <template #trigger>
              <var-button class="md3-fab" type="primary" icon-container data-reader-tags :aria-label="t('editEpisodeTags')" :title="t('editEpisodeTags')" @pointerdown.stop @pointerup.stop @pointercancel.stop @click.stop><MdiIcon :path="mdiTagPlusOutline" /></var-button>
            </template>
          </var-fab>
        </div>
        <ReaderSlider ref="pageSliderRef" class="reader-page-progress" :icon-path="mdiImageOutline" :aria-label="t('pageProgress')" @input="reader?.openPage($event - 1)" />
      </div>
    </section>
  </div>
</template>

<style>
/* Main shell -------------------------------------------------------------- */

.app-shell > .top-app-bar { transition: height 180ms ease, min-height 180ms ease, transform 180ms ease; }
.app-shell.touch-header-hidden > .top-app-bar { height: 0; min-height: 0; padding-block: 0; overflow: hidden; transform: translateY(-100%); visibility: hidden; }
.app-shell.touch-header-hidden::before { display: none; }
.app-shell.touch-header-hidden > .workspace-grid { height: 100%; }

.workspace-grid {
  height: calc(100% - var(--titlebar-height));
  display: grid;
  grid-template-columns: clamp(248px, 26vw, 410px) minmax(0, 1fr);
  gap: 0;
  padding: 0;
}

/* Collection and episode panes -------------------------------------------- */

.collection-pane, .episodes-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border: 0;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}
.collection-pane { border-right: 1px solid var(--outline-soft); }
.collection-pane .var-card__floater,
.collection-pane .var-card__container,
.collection-pane .var-card__content,
.episodes-pane .var-card__floater,
.episodes-pane .var-card__container,
.episodes-pane .var-card__content { height: 100%; min-height: 0; }
.collection-pane .var-card__content,
.episodes-pane .var-card__content { display: flex; flex-direction: column; }
.collection-pane .var-card__floater,
.collection-pane .var-card__container,
.collection-pane .var-card__content,
.episodes-pane .var-card__floater,
.episodes-pane .var-card__container,
.episodes-pane .var-card__content { background: transparent !important; box-shadow: none !important; }
.collection-pane .var-card__container,
.episodes-pane .var-card__container { padding: 0 !important; }
.collection-pane .var-card__content,
.episodes-pane .var-card__content { margin: 0 !important; padding: 0 !important; }

/* Collection list --------------------------------------------------------- */

.collection-list { min-height: 0; flex: 1; overflow: auto; padding: 4px 14px 88px; }
.android-library-change { margin-left: auto; }
.android-library-prompt { min-height: 220px; display: grid; place-items: center; align-content: center; gap: 10px; padding: 24px; color: var(--muted); text-align: center; }
.android-library-prompt > .mdi-icon { color: var(--primary); }
.android-library-prompt strong { color: var(--text); font-size: 15px; }
.android-library-prompt span { max-width: 300px; font-size: 12px; line-height: 1.55; }
.collection-system-items { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--outline-soft); }
.collection-item { min-height: 48px !important; height: auto !important; margin: 4px 0; padding: 8px 12px !important; border-radius: 16px !important; color: var(--text) !important; transition: color 140ms ease, background-color 140ms ease, box-shadow 140ms ease; }
.collection-item .var-button__content { width: 100%; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 10px; overflow: hidden; }
.collection-system-items .collection-item .var-button__content { grid-template-columns: 24px minmax(0, 1fr) auto; text-align: left; }
.collection-system-items .collection-copy { grid-column: 2; }
.collection-item.active { color: var(--on-secondary-container) !important; background: var(--secondary-container) !important; }
.collection-item.drop-target {
  color: var(--on-primary-container) !important;
  background: color-mix(in srgb, var(--primary-container) 82%, var(--surface-high)) !important;
  box-shadow: inset 0 0 0 2px var(--primary);
}
.collection-copy { min-width: 0; display: grid; gap: 2px; text-align: left; }
.collection-copy strong, .collection-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.collection-copy strong { font-size: 14px; font-weight: 550; }
.collection-copy small { color: var(--muted); font-size: 11px; }
.collection-count { justify-self: end; font-variant-numeric: tabular-nums; }
.collection-preview { grid-column: 1 / -1; height: 38px; display: flex; gap: 3px; overflow: hidden; }
.collection-preview img { width: 34px; height: 38px; flex: 0 0 auto; border-radius: 7px; object-fit: cover; background: var(--surface-highest); }
.collection-preview-more { width: 34px; height: 38px; flex: 0 0 34px; display: grid; place-items: center; border-radius: 7px; background: var(--surface-highest); }
.collection-preview-more .var-badge__content { position: static; transform: none; }
.collection-create-fab { z-index: 50 !important; }
.md3-fab { width: 56px !important; height: 56px !important; min-width: 56px !important; padding: 0 !important; border-radius: 18px !important; box-shadow: 0 4px 10px rgba(0, 0, 0, .34); }
.md3-fab .var-button__content { display: grid !important; place-items: center; }

/* Episode heading and toolbar --------------------------------------------- */

.episode-heading { justify-content: flex-start; }
.mobile-pane-back { display: none !important; }
.episode-total { font-variant-numeric: tabular-nums; }
.pane-heading-actions, .episode-heading-actions { margin-left: auto; display: flex; align-items: center; gap: 2px; }
.pane-heading-library { display: none; }
.collection-actions { display: flex; align-items: center; gap: 2px; overflow: visible; }
.collection-actions .var-button { border: 0 !important; border-radius: 9px !important; background: var(--surface-highest) !important; }
.collection-tag-row { min-height: 40px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 4px 16px 8px; }

/* Filter row -------------------------------------------------------------- */

.filter-row { position: relative; flex: 0 0 auto; display: grid; grid-template-columns: minmax(110px, 1fr) minmax(104px, 176px) 112px minmax(104px, 144px); align-items: center; gap: 8px; padding: 6px 16px 10px; }
.filter-row > .var-menu, .filter-row > .tag-filter-control, .filter-row > .tag-filter-control > .var-menu { width: 100%; min-width: 0; display: flex; }
.active-tag-filters { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 8px; }

/* Episode list ------------------------------------------------------------ */

.episode-scroll { min-height: 0; flex: 1; overflow: auto; contain: strict; transition: background-color 120ms ease; }
.episode-scroll.reordering { background: color-mix(in srgb, var(--primary) 8%, transparent); }
.virtual-canvas { position: relative; width: 100%; }
.episode-insert-line { position: absolute; z-index: 5; left: 16px; right: 16px; height: 3px; border-radius: 9999px; background: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 22%, transparent); pointer-events: none; }
.episode-row {
  position: absolute;
  inset: 4px 16px auto;
  height: 92px;
  display: grid;
  grid-template-columns: 18px 126px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 10px;
  border-radius: 20px;
  background: var(--surface-high);
  content-visibility: auto;
  contain: layout paint style;
  transition: background-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
  will-change: transform, opacity;
}
.episode-row:hover { background: #2a2c32; }
.episode-row.selected { box-shadow: inset 0 0 0 1px var(--primary); background: var(--primary-container); }
.episode-row.dragging { opacity: .52; }
.episode-row.ordered { grid-template-columns: 18px 36px 126px minmax(0, 1fr) auto; }
.episode-row.dragging .drag-handle { cursor: grabbing; }
.order-number { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.thumb-pair { width: 126px; height: 70px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; overflow: hidden; border-radius: 10px; background: var(--outline-soft); }
.thumb-pair img { width: 100%; height: 100%; min-height: 0; display: block; object-fit: cover; background: var(--surface-highest); }
.thumb-pair img:only-child { grid-column: 1 / -1; }
.thumb-empty { grid-column: 1 / -1; display: grid; place-items: center; color: var(--muted); font-size: 11px; }
.episode-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.episode-title { min-width: 0; display: flex; align-items: center; gap: 8px; }
.episode-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; }
.episode-title > span { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.episode-meta { min-width: 0; display: flex; align-items: center; gap: 8px; margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 18px; }
.episode-meta .warning { color: var(--warning); }
.episode-supporting { min-width: 0; height: 24px; display: flex; align-items: center; gap: 6px; margin-top: 2px; overflow: hidden; white-space: nowrap; }
.episode-themes { min-width: 0; max-width: 38%; overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; }
.episode-themes::after { content: "·"; margin-left: 6px; color: var(--outline); }
.episode-tags { min-width: 0; display: flex; align-items: center; gap: 4px; overflow: hidden; }
.episode-tags .var-chip { flex: 0 0 auto; }
.episode-actions { display: flex; align-items: center; gap: 2px; }

@media (pointer: coarse) {
  .episode-row, .episode-row * { -webkit-touch-callout: none; user-select: none; -webkit-user-drag: none; }
  .episode-row { touch-action: pan-y; }
}

/* Tag assignment dialog --------------------------------------------------- */

.tag-assignment { max-height: 58vh; overflow: auto; }
.assignment-category { margin: 4px 0; padding: 12px; border-bottom: 1px solid var(--outline-soft); border-left: 3px solid var(--tag-accent); border-radius: 12px; background: color-mix(in srgb, var(--tag-container) 16%, transparent); }
.assignment-category h3 { margin: 0 0 8px; font-size: 14px; }

/* Reader settings dialog -------------------------------------------------- */

.settings-grid { display: grid; gap: 16px; padding-top: 8px; }
.settings-field { display: grid; gap: 7px; color: var(--muted); font-size: 13px; }
.settings-field small { line-height: 1.45; }
.reader-settings .settings-label { color: var(--text); font-size: 13px; font-weight: 600; }
.reader-settings .settings-divider { padding-top: 6px; border-top: 1px solid var(--outline-soft); color: var(--muted); font-size: 12px; font-weight: 600; letter-spacing: .02em; }
.reader-settings .var-segmented-buttons { width: 100%; }
.reader-settings .settings-switch { grid-template-columns: 1fr auto; align-items: center; }
.reader-settings .settings-switch .settings-label { grid-column: 1; }
.reader-settings .settings-switch .var-switch { grid-column: 2; }
.reader-settings .settings-switch small { grid-column: 1 / -1; }

/* Recognition editor ------------------------------------------------------ */

.recognition-editor { display: grid; gap: 10px; padding-top: 4px; max-height: min(60vh, 540px); overflow-y: auto; }
.recognition-rule-row { display: grid; grid-template-columns: 1fr 1fr 36px; align-items: center; gap: 8px; }
.filename-marker-row { display: grid; grid-template-columns: minmax(0, 1fr) 36px; align-items: center; gap: 8px; }
.recognition-section-title { margin: 12px 0 0; font-size: 14px; font-weight: 500; }
.episode-date { color: var(--muted); font-family: var(--font-mono); font-size: 11px; }

/* Reader ------------------------------------------------------------------ */

.reader {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  grid-template-rows: var(--titlebar-height) minmax(0, 1fr);
  color: var(--text);
  background: #08090b;
  --reader-bg: #08090a;
}
.reader[hidden] { display: none; }
.reader::before { content: ""; position: fixed; z-index: 9; top: calc(var(--titlebar-height) - 1px); left: 0; right: 0; height: 1px; background: var(--outline-soft); pointer-events: none; }
.reader-bar { width: env(titlebar-area-width, 100%); min-width: 0; height: var(--titlebar-height); z-index: 8; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; margin-left: env(titlebar-area-x, 0px); padding: 0 8px; border-bottom: 0; background: #1d1e22; transition: opacity 180ms ease, transform 220ms cubic-bezier(.2, .8, .2, 1); -webkit-app-region: drag; app-region: drag; }
.reader-bar button, .reader-bar input, .reader-bar [role="button"], .reader-bar .var-menu { -webkit-app-region: no-drag; app-region: no-drag; }
.reader-leading { min-width: 0; display: flex; align-items: center; gap: 4px; }
.reader-heading { min-width: 0; max-width: min(260px, 22vw); display: flex; flex: 0 1 260px; flex-direction: column; }
.reader-breadcrumb { min-width: 0; display: flex; align-items: center; gap: 3px; }
.reader-breadcrumb > span, .reader-breadcrumb > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reader-breadcrumb > span { flex: 0 1 auto; color: var(--muted); font-size: 13px; }
.reader-breadcrumb > strong { flex: 1 1 auto; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.reader-breadcrumb .mdi-icon { color: var(--outline); }
.reader-meta { display: none; }
.reader-peek-controls { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
.reader-text-action { height: 32px !important; min-height: 32px !important; padding-inline: 10px !important; }
.reader-text-action .var-button__content { display: inline-flex !important; align-items: center; gap: 7px; }
.reader-peek-controls [data-reader-settings] { width: 32px !important; height: 32px !important; padding: 0 !important; }
.reader-peek-controls .is-active { color: var(--on-secondary-container) !important; background: var(--secondary-container) !important; }
.reader-tools { min-width: 0; display: flex; align-items: center; justify-self: end; gap: 2px; }
.reader-tools > .var-menu { display: inline-flex; }
.reader-window-controls { display: none; align-self: stretch; margin: 0 -8px 0 4px; }
.reader-window-controls button { width: 46px; height: 40px; display: grid; place-items: center; padding: 0; border: 0; color: var(--text); background: transparent; cursor: default; }
.reader-window-controls button:hover { background: color-mix(in srgb, var(--text) 12%, transparent); }
.reader-window-controls .reader-window-close:hover { color: #fff; background: #c42b1c; }
.reader-stage { position: relative; min-width: 0; min-height: 0; display: grid; grid-template: "viewport" minmax(0, 1fr) "page" auto "episode" auto / minmax(0, 1fr); overflow: hidden; }
.reader-viewport { position: relative; grid-area: viewport; min-width: 0; min-height: 0; overflow: hidden; touch-action: none; cursor: default; background: var(--reader-bg, #08090a); timeline-scope: --reader-peek-x, --reader-peek-y; }
.reader-scroll { position: absolute; inset: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: none; touch-action: none; }
.reader-scroll.is-native-pan { touch-action: pan-x pan-y; }
.reader-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
.reader-plane { position: relative; cursor: grab; }
.reader.is-mode-continuous .reader-edge-cue { display: none; }
.reader.is-dragging .reader-plane { cursor: grabbing; }
.reader.is-cursor-hidden .reader-plane, .reader.is-peek-interactive .reader-plane, .reader.is-peek-transitioning .reader-plane { cursor: none; }
.reader.is-peek-pressing, .reader.is-peek-pressing * { cursor: none !important; }
/* Shared page-tile abstraction used by both layers (base + Peek). */
.reader-page, .reader-peek-page { position: absolute; left: 0; top: 0; overflow: hidden; transition: opacity 250ms ease, filter 250ms ease; }
.reader-page { background: transparent; }
.reader-page.is-loading, .reader-peek-page.is-loading { opacity: 0; }
.reader-span, .reader-peek-span { position: absolute; left: 0; top: 0; }
.reader-page-image, .reader-peek-image { display: block; width: 100%; height: 100%; object-fit: contain; }
.reader-page-fade { position: absolute; inset: 0; }
.reader-page-image { user-select: none; }
.reader-peek-mask { position: absolute; inset: 0; z-index: 2; pointer-events: none; overflow: hidden; mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat; transition: opacity var(--peek-fade-duration, 250ms) cubic-bezier(.2, .7, .2, 1); }
.reader-peek-mover { position: absolute; left: 0; top: 0; }
.reader-peek-mover.is-mirror {
  animation: reader-peek-mirror-x linear both, reader-peek-mirror-y linear both;
  animation-timeline: --reader-peek-x, --reader-peek-y;
}
@keyframes reader-peek-mirror-x { from { translate: 0 0; } to { translate: -100% 0; } }
@keyframes reader-peek-mirror-y { from { transform: translateY(0); } to { transform: translateY(-100%); } }
.reader-peek-track { position: absolute; left: 0; top: 0; }
.reader.is-mode-single .reader-page:not(.is-current) { visibility: hidden; }
.reader.is-focus-dim.is-mode-focus .reader-page:not(.is-current) { opacity: .32; cursor: pointer; }
.reader.is-mode-single .reader-peek-page:not(.is-current) { visibility: hidden; }
.reader.is-focus-dim.is-mode-focus .reader-peek-page:not(.is-current) { opacity: .32; }
.reader-edge-cue { position: absolute; z-index: 3; top: 0; bottom: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; opacity: 0; color: var(--text); pointer-events: none; transition: opacity 140ms ease; }
.reader-edge-cue .mdi-icon { flex: 0 0 auto; display: grid; place-items: center; width: 42px; height: 58px; border: 1px solid color-mix(in srgb, var(--outline) 72%, transparent); border-radius: 18px; background: color-mix(in srgb, var(--surface-highest) 76%, transparent); backdrop-filter: blur(12px); }
.reader-edge-prev { left: 0; width: var(--reader-prev-zone-width, 0px); }
.reader-edge-next { right: 0; width: var(--reader-next-zone-width, 0px); }
.reader.is-page-zone-prev .reader-edge-prev,
.reader.is-page-zone-next .reader-edge-next { opacity: 1; }
.reader-tag-fab { z-index: 6 !important; transition: opacity 180ms ease, visibility 180ms ease, transform 220ms cubic-bezier(.2, .8, .2, 1); }
.reader.is-fullscreen { grid-template-rows: minmax(0, 1fr); }
.reader.is-fullscreen .reader-bar { position: absolute; inset: 0 auto auto 0; width: 100%; height: var(--titlebar-height); margin-left: 0; opacity: 0; visibility: hidden; transform: translateY(-105%); pointer-events: none; }
.reader.is-fullscreen::before { opacity: 0; visibility: hidden; }
.reader.is-fullscreen.is-chrome-visible::before { opacity: 1; visibility: visible; }
.reader.is-fullscreen [data-reader-fullscreen] { display: inline-flex; }
.reader.is-fullscreen .reader-window-controls { display: flex; }
.reader.is-fullscreen .reader-stage { grid-row: 1; display: block; }
.reader.is-fullscreen .reader-viewport { position: absolute; inset: 0; }
.reader.is-fullscreen .reader-tag-fab { bottom: 22px !important; opacity: 0; visibility: hidden; transform: translateY(14px); pointer-events: none; }
.reader.is-fullscreen.is-chrome-visible .reader-bar,
.reader.is-fullscreen.is-chrome-visible .reader-tag-fab { opacity: 1; visibility: visible; pointer-events: auto; }
.reader.is-fullscreen.is-chrome-visible .reader-bar,
.reader.is-fullscreen.is-chrome-visible .reader-tag-fab { transform: none; }
.reader-open { overflow: hidden; }

/* Reader landscape -------------------------------------------------------- */

@media (orientation: landscape) and (min-width: 840px) {
  .reader-stage { display: block; }
  .reader-viewport { position: absolute; inset: 0; }
  .reader-tag-fab { right: 76px !important; bottom: 22px !important; }
}

/* Narrow desktop ---------------------------------------------------------- */

@media (max-width: 1100px) {
  .episode-row { grid-template-columns: 18px 104px minmax(0, 1fr) auto; }
  .episode-row.ordered { grid-template-columns: 18px 30px 104px minmax(0, 1fr) auto; }
  .thumb-pair { width: 104px; }
  .reader-tools [data-reader-zoom-out], .reader-tools [data-reader-fit], .reader-tools [data-reader-zoom-in] { display: none; }
}

@media (max-width: 760px) {
  .reader-bar { padding-inline: 4px; overflow: hidden; }
  .reader-meta { display: none; }
}

/* Compact layout ---------------------------------------------------------- */

@media (max-width: 760px) {
  .collection-create-fab {
    right: max(8px, env(safe-area-inset-right)) !important;
    bottom: 10px !important;
  }
  .collection-create-fab.md3-fab { width: 44px !important; min-width: 44px !important; height: 44px !important; border-radius: 14px !important; }

  .collection-tag-row { min-height: 36px; gap: 5px; padding: 2px 8px 5px; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; }
  .collection-tag-row::-webkit-scrollbar { display: none; }
  .filter-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
    padding: 4px 8px 8px;
  }
  .filter-row > :first-child { grid-column: 1 / -1; }
  .filter-row > .sort-filter-control { grid-column: 1 / -1; }

  .episode-scroll { padding-bottom: env(safe-area-inset-bottom); }
  .episode-row, .episode-row.ordered {
    inset-inline: 8px;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 9px;
    padding: 10px;
    border-radius: 14px;
  }
  .episode-row > .drag-handle.mdi-icon { display: none; }
  .episode-row .order-number {
    position: absolute;
    z-index: 2;
    left: 14px;
    top: 13px;
    padding: 2px 5px;
    border-radius: 6px;
    color: var(--text);
    background: rgba(8, 9, 10, .72);
  }
  .thumb-pair { width: 72px; height: 72px; }
  .episode-copy { align-self: stretch; justify-content: flex-start; padding: 3px 0 34px; }
  .episode-title strong { font-size: 14px; }
  .episode-meta { gap: 5px; margin-top: 2px; font-size: 11px; }
  .episode-supporting { display: none; }
  .episode-actions { position: absolute; right: 8px; bottom: 7px; gap: 0; }
  .episode-actions .var-button { width: 36px !important; min-width: 36px !important; height: 36px !important; padding: 0 !important; }
  .episode-insert-line { left: 8px; right: 8px; }

  .reader { grid-template-rows: var(--titlebar-height) minmax(0, 1fr); }
  .reader-bar {
    height: var(--titlebar-height);
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: calc(40px + env(safe-area-inset-top)) 48px;
    gap: 0 4px;
    padding: env(safe-area-inset-top) max(6px, env(safe-area-inset-right)) 0 max(6px, env(safe-area-inset-left));
  }
  .reader-leading { min-width: 0; }
  .reader-heading { max-width: none; flex-basis: auto; }
  .reader-breadcrumb > span { display: none; }
  .reader-tools { grid-column: 2; grid-row: 1; }
  .reader-tools [data-reader-help], .reader-tools [data-reader-zoom-out], .reader-tools [data-reader-fit], .reader-tools [data-reader-zoom-in] { display: none; }
  .reader-peek-controls { overflow-x: auto; justify-content: flex-end; scrollbar-width: none; }
  .reader-text-action { height: 38px !important; min-height: 38px !important; }
  .reader-peek-controls [data-reader-settings] { width: 38px !important; height: 38px !important; }
  .reader-tools .var-button { width: 38px !important; min-width: 38px !important; height: 38px !important; padding: 0 !important; }
  .reader-tag-fab { right: max(10px, env(safe-area-inset-right)) !important; bottom: calc(104px + env(safe-area-inset-bottom)) !important; }
  .reader.is-fullscreen .reader-bar { height: var(--titlebar-height); }
  .reader.is-fullscreen .reader-window-controls { display: none; }
  .reader.is-fullscreen .reader-tag-fab { right: max(10px, env(safe-area-inset-right)) !important; bottom: calc(18px + env(safe-area-inset-bottom)) !important; }
}

/* Portrait layout --------------------------------------------------------- */

.mobile-settings { display: none; }

@media (max-width: 760px) and (orientation: portrait) {
  .mobile-settings { display: inline-flex; }

  .workspace-grid {
    position: relative;
    height: calc(100dvh - var(--titlebar-height));
    display: block;
    overflow: hidden;
  }
  .collection-pane, .episodes-pane {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    min-height: 0;
    border: 0;
    background: var(--app-bg) !important;
    transition: transform 280ms cubic-bezier(.2, 0, 0, 1), opacity 220ms ease;
    will-change: transform;
  }
  .collection-pane { z-index: 1; transform: translateX(0); }
  .episodes-pane { z-index: 2; transform: translateX(100%); box-shadow: -10px 0 28px rgba(0, 0, 0, .28) !important; }
  .workspace-grid.mobile-collection-open .collection-pane { opacity: .72; transform: translateX(-24%); }
  .workspace-grid.mobile-collection-open .episodes-pane { transform: translateX(0); }

  .collection-pane .pane-heading, .episodes-pane .pane-heading {
    min-height: 56px;
    height: 56px;
    padding: 8px max(12px, env(safe-area-inset-right)) 6px max(12px, env(safe-area-inset-left));
  }
  .collection-pane .pane-heading h2, .episodes-pane .pane-heading h2 { font-size: 20px; line-height: 28px; }
  .android-library-change { width: 44px !important; min-width: 44px !important; height: 44px !important; padding: 0 !important; }
  .collection-list {
    display: block;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 2px max(8px, env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
    scroll-snap-type: none;
    scrollbar-width: none;
    touch-action: pan-y;
  }
  .collection-system-items { display: block; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--outline-soft); }
  .collection-item {
    width: 100%;
    min-width: 0 !important;
    min-height: 64px !important;
    height: auto !important;
    margin: 2px 0;
    padding: 10px 12px !important;
    border-radius: 12px !important;
  }
  .collection-preview { height: 42px; display: flex; }
  .collection-preview img { width: 38px; height: 42px; }
  .collection-create-fab { display: none !important; }

  .mobile-pane-back {
    width: 44px !important;
    min-width: 44px !important;
    height: 44px !important;
    display: inline-flex !important;
    margin-left: -8px;
    padding: 0 !important;
  }
  .episode-heading { gap: 4px; }
  .episode-heading-title { min-width: 0; flex: 1; }
  .episode-heading .overline { display: none; }
  .episode-heading h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pane-heading-library { display: inline-flex; }
  .collection-actions, .collection-tag-row { display: none !important; }
  .filter-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
    padding: 4px 8px 8px;
  }
  .filter-row > :first-child { grid-column: 1 / -1; }
  .filter-row > .sort-filter-control { grid-column: 1 / -1; }
  .active-tag-filters { overflow-x: auto; flex-wrap: nowrap; padding-inline: 8px; scrollbar-width: none; }
  .active-tag-filters::-webkit-scrollbar { display: none; }
  .episode-scroll { padding-bottom: env(safe-area-inset-bottom); }
  .episode-row, .episode-row.ordered {
    inset-inline: 8px;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 10px;
    padding: 10px;
    border-radius: 12px;
    cursor: pointer;
  }
  .episode-row > .drag-handle.mdi-icon, .episode-actions, .episode-supporting { display: none; }
  .thumb-pair { width: 72px; height: 72px; }
  .episode-copy { align-self: stretch; justify-content: center; padding: 0; }
  .episode-title strong { font-size: 15px; }
  .episode-meta { margin-top: 4px; }

  .reader {
    --titlebar-height: calc(92px + env(safe-area-inset-top));
    grid-template-rows: var(--titlebar-height) minmax(0, 1fr);
  }
  .reader-bar {
    height: var(--titlebar-height);
    grid-template-rows: calc(44px + env(safe-area-inset-top)) 48px;
  }
  .reader-leading [data-reader-close] { width: 44px !important; min-width: 44px !important; height: 44px !important; }
  .reader-tools [data-reader-fullscreen] { width: 44px !important; min-width: 44px !important; height: 44px !important; }
  .reader-tag-fab { display: none !important; }
  .reader.is-fullscreen { --titlebar-height: calc(92px + env(safe-area-inset-top)); }
}

/* Touch reader chrome ----------------------------------------------------- */

@media (max-width: 760px) {
  .reader, .reader.is-fullscreen { --titlebar-height: calc(100px + env(safe-area-inset-top)); }
  .reader-bar, .reader.is-fullscreen .reader-bar {
    box-sizing: border-box; height: var(--titlebar-height); width: 100%; margin: 0;
    padding: env(safe-area-inset-top) 8px 0; overflow: visible;
    grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: 44px 56px;
  }
  .reader-leading { grid-column: 1; grid-row: 1; min-width: 0; overflow: hidden; }
  .reader-heading, .reader-breadcrumb { min-width: 0; overflow: hidden; }
  .reader-breadcrumb strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .reader-tools { grid-column: 2; grid-row: 1; }
  .reader-tools .reader-help-menu, .reader-tools [data-reader-zoom-out], .reader-tools [data-reader-zoom-in], .reader-tools [data-reader-fit] { display: none; }
  .reader-peek-controls { gap: 0; }
  .reader-peek-controls [data-reader-settings] { display: none; }
  .reader-stage { display: grid; grid-template: "viewport" minmax(0, 1fr) "page" auto "episode" auto / minmax(0, 1fr); }
  .reader-viewport { position: relative; inset: auto; min-height: 0; touch-action: none; }
  .reader.is-fullscreen [data-reader-fullscreen] { display: inline-flex; }
  .reader-tag-fab { display: none !important; }
}
</style>
