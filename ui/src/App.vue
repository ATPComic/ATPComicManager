<script setup>
import PageSkeleton from './components/PageSkeleton.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw } from 'vue';
import { Dialog, Snackbar } from '@varlet/ui';
import {
  mdiBookMultipleOutline,
  mdiBookOpenPageVariantOutline,
  mdiChevronLeft,
  mdiChevronRight,
  mdiCogOutline,
  mdiDeleteOutline,
  mdiDragVertical,
  mdiFolderOpenOutline,
  mdiFullscreen,
  mdiImageOutline,
  mdiMagnify,
  mdiMagnifyMinusOutline,
  mdiMagnifyPlusOutline,
  mdiPencilOutline,
  mdiPlus,
  mdiSelectionEllipse,
  mdiTagArrowDownOutline,
  mdiTagOutline,
  mdiTagPlusOutline,
  mdiTuneVariant,
  mdiWindowClose,
  mdiWindowMinimize,
  mdiWindowRestore,
} from './icons.js';
import AppTopBar from './components/AppTopBar.vue';
import MdiIcon from './components/MdiIcon.vue';
import ReaderHelp from './components/ReaderHelp.vue';
import ReaderSlider from './components/ReaderSlider.vue';
import ReaderVariants from './components/ReaderVariants.vue';
import TagAssignmentPicker from './components/TagChipPicker.vue';
import TagDisplayChip from './components/TagDisplayChip.vue';
import TagFilterControl from './components/TagFilterControl.vue';
import DateFilterControl from './components/DateFilterControl.vue';
import EpisodeDateControl from './components/EpisodeDateControl.vue';
import { chooseAndroidLibrary, isAndroidApp, nativeAssetUrl, requestJson } from './api.js';
import { navigateToPage, returnPathFromHref } from './navigation.js';
import { tagCategoryStyle as getTagCategoryStyle } from './tag-colors.js';
import { EPISODE_DRAG_TYPE, draggedEpisodeId, compareEpisodesByDate, countTagEpisodes, matchesDateFilter, matchesTagFilter, moveItemToSlot } from '../../public/collection-model.js';
import { locale, t } from '../../public/i18n.js';
import { ComicReader } from '../../public/reader.js';
import { getThumbnailUrl, setReaderAssetUrlResolver } from '../../public/reader-model.js';
import { readInitialViewState } from '../../public/view-state.js';
import {
  flattenTagDefinitions,
  getOrderedTagEntries
} from '../../public/tag-model.js';
import { getVirtualWindow } from '../../public/virtual-list.js';

const READER_SETTINGS_KEY = 'comic-manager.reader-settings';
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
  tags: { version: 3, categories: [], episodeTags: {} },
  recognition: { version: 1, rules: [], episodeDates: {}, identityMarkers: [] },
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
const settingsDraft = reactive({ radius: 144, feather: 32, animationSpeed: 100 });
const selectedLocale = ref(locale);
const dropIndex = ref(null);
const dropThemeTitle = ref(null);
const pageSliderRef = ref(null);
const episodeSliderRef = ref(null);
const readerVariantsRef = ref(null);
const mobileCollectionOpen = ref(false);
const portraitReaderMode = window.matchMedia('(max-width: 760px) and (orientation: portrait)');

let reader;
let resizeObserver;
let scrollFrame = 0;
let suppressCollectionClickUntil = 0;
let suppressEpisodeClickUntil = 0;

function cloneData(value) {
  return structuredClone(toRaw(value));
}

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
  return Object.entries(state.library.episodes ?? {}).sort(compareEpisodesByDate).map(([episodeId]) => episodeId);
}

function episodeLabel(episodeId) {
  return state.library.episodes?.[episodeId]?.title ?? episodeId;
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
  return (state.library.warnings ?? []).filter((warning) => warning.episodeId === episodeId);
}

function variantSummary(episode) {
  return variantStats(episode)
    .map(({ variant, count }) => `${variant}${count}`)
    .join('  ');
}

function variantStats(episode) {
  return Object.entries(episode?.variants ?? {})
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

function mergeTagMaps(target, source) {
  const result = cloneData(target ?? {});
  for (const [categoryId, values] of Object.entries(source ?? {})) {
    result[categoryId] = [...new Set([...(result[categoryId] ?? []), ...(values ?? [])])];
  }
  return result;
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
    return [episodeId, episode.title, episode.date, episode.layout, themes.join(' '), variantSummary(episode), tags]
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

const filteredEpisodeIds = computed(() => filterScopeEpisodeIds.value.filter((episodeId) => (
  matchesTagFilter(state.tags.episodeTags[episodeId], state.tagFilters, state.tags.categories)
  && matchesDateFilter(episodeId, state.library.episodes[episodeId], state.dateFilter)
)));

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

const canReorder = computed(() => !!activeTheme.value && !state.search.trim() && !hasActiveTagFilters.value);
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
  const ids = [...new Set(theme?.episodes ?? [])]
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
  if (portraitReaderMode.matches) {
    openReader(episodeId);
    return;
  }
  state.selectedEpisodeId = episodeId;
}

function closeMobileCollection() {
  if (window.history.state?.mobileCollectionOpen) window.history.back();
  else mobileCollectionOpen.value = false;
}

function syncMobileNavigation(event) {
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

function readerSequence(currentEpisodeId) {
  const theme = (activeTheme.value?.episodes ?? []).includes(currentEpisodeId)
    ? activeTheme.value
    : state.themes.find((candidate) => (candidate.episodes ?? []).includes(currentEpisodeId));
  return theme?.episodes?.filter((id) => state.library.episodes[id]) ?? episodeIds();
}

function readerCollection(currentEpisodeId) {
  const theme = (activeTheme.value?.episodes ?? []).includes(currentEpisodeId)
    ? activeTheme.value
    : state.themes.find((candidate) => (candidate.episodes ?? []).includes(currentEpisodeId));
  return theme
    ? { title: theme.title, episodes: theme.episodes.filter((id) => state.library.episodes[id]) }
    : null;
}

function openReader(episodeId) {
  readerReturnPath = null;
  state.selectedEpisodeId = episodeId;
  if (portraitReaderMode.matches && !window.history.state?.readerEpisode) {
    window.history.pushState({ ...(window.history.state ?? {}), mobileCollectionOpen: true, readerEpisode: episodeId }, '');
  }
  reader?.open(episodeId);
}

function goTo(path) {
  navigateToPage(path);
}

function openVariantAssignments(episodeId) {
  navigateToPage(`/variants.html?episode=${encodeURIComponent(episodeId)}`);
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
  await nextTick();
  const element = listRef.value;
  if (!element) return;
  const top = Math.max(0, index * ROW_HEIGHT - (element.clientHeight - ROW_HEIGHT) / 2);
  element.scrollTop = top;
  scrollTop.value = top;
}

function notify(message, type = 'success') {
  Snackbar[type] ? Snackbar[type]({ content: message, position: 'bottom' }) : Snackbar(message);
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
    setReaderAssetUrlResolver((kind, episodeId, index) => nativeAssetUrl(state.library.episodes?.[episodeId]?.files?.[index]));
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
    setReaderAssetUrlResolver((kind, episodeId, index) => nativeAssetUrl(state.library.episodes?.[episodeId]?.files?.[index]));
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
  const blob = new Blob([`${JSON.stringify(payload.export, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ATP-Comic-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
  const contentY = event.clientY - rect.top + listRef.value.scrollTop;
  dropIndex.value = Math.max(0, Math.min(filteredEpisodeIds.value.length, Math.round(contentY / ROW_HEIGHT)));
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
  Object.assign(settingsDraft, reader.getPeekSettings());
  settingsDialogOpen.value = true;
}

function saveReaderSettings() {
  const settings = reader.setPeekSettings(settingsDraft);
  localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
  Object.assign(settingsDraft, settings);
  notify(t('savedPeek'));
}

function changeLocale(value) {
  localStorage.setItem('comic-manager.locale', value);
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

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  cancelAnimationFrame(scrollFrame);
  window.removeEventListener('popstate', syncMobileNavigation);
});
</script>

<template>
  <var-dialog v-model:show="androidImportOpen" :title="t('chooseReadingDirectory')" :cancel-button="true" @confirm="importAndroidReadingDirectory">
    <var-switch v-model="copyAndroidLibrary">{{ t('copyLibraryToApp') }}</var-switch>
    <p>{{ t('copyLibraryToAppNote') }}</p>
  </var-dialog>
  <div class="app-shell">
    <AppTopBar
      :busy-action="state.busyAction"
      :issue-count="state.library.warnings?.length ?? 0"
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
    />

    <PageSkeleton v-if="pageLoading" />
    <main v-show="!pageLoading" class="workspace-grid" :class="{ 'mobile-collection-open': mobileCollectionOpen }">
      <var-card class="collection-pane" elevation="0">
        <header class="pane-heading">
          <h2>{{ t('collections') }}</h2>
          <var-button v-if="isAndroidApp" class="android-library-change" round text :aria-label="t('chooseReadingDirectory')" :title="t('chooseReadingDirectory')" @click="chooseAndroidReadingDirectory"><MdiIcon :path="mdiFolderOpenOutline" /></var-button>
        </header>
        <div ref="collectionListRef" class="collection-list">
          <section v-if="isAndroidApp && !androidLibraryInitialized" class="android-library-prompt">
            <MdiIcon :path="mdiFolderOpenOutline" size="34" />
            <strong>{{ t('androidLibraryPrompt') }}</strong>
            <span>{{ t('androidLibrarySupporting') }}</span>
            <var-button type="primary" @click="chooseAndroidReadingDirectory">{{ t('chooseReadingDirectory') }}</var-button>
          </section>
          <div v-if="!isAndroidApp || androidLibraryInitialized" class="collection-system-items">
            <var-button
              block
              text
              class="collection-item"
              :class="{ active: !state.selectedThemeTitle && !state.unassignedOnly }"
              @click="selectCollectionFromClick()"
            >
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
              <span class="collection-copy"><strong>{{ t('unassigned') }}</strong></span>
              <var-badge class="collection-count" :value="unassignedEpisodeIds.length" :max-value="999" :type="!state.selectedThemeTitle && state.unassignedOnly ? 'primary' : 'info'" />
            </var-button>
          </div>
          <var-button
            v-for="theme in state.themes"
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
                :src="getThumbnailUrl(episodeId, 0)"
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
          <div><span class="overline">{{ t('episodesOverline') }}</span><h2>{{ collectionTitle }}</h2></div>
          <var-badge class="episode-total" :value="filteredEpisodeIds.length" :max-value="9999" type="info" />
          <var-button-group v-if="activeTheme" mode="outline" size="small" :elevation="false" class="collection-actions">
            <var-button outline :title="t('editCollectionTags')" :aria-label="t('editCollectionTags')" @click="openTagAssignment('collection', activeTheme.title)"><MdiIcon :path="mdiTagOutline" /></var-button>
            <var-button outline :class="{ 'is-muted-action': !hasCollectionTags }" :title="hasCollectionTags ? t('applyCollectionTags') : t('collectionNoTags')" :aria-label="t('applyCollectionTags')" @click="applyCollectionTags"><MdiIcon :path="mdiTagArrowDownOutline" /></var-button>
            <var-button outline :title="t('renameCollection')" :aria-label="t('renameCollection')" @click="openNameDialog('rename')"><MdiIcon :path="mdiPencilOutline" /></var-button>
            <var-button outline class="danger-action" :title="t('deleteCollection')" :aria-label="t('deleteCollection')" @click="deleteTheme"><MdiIcon :path="mdiDeleteOutline" /></var-button>
          </var-button-group>
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

        <div ref="listRef" class="episode-scroll" @scroll="onListScroll" @dragover.prevent="onListDragOver" @drop.prevent="dropAtIndex">
          <div v-if="filteredEpisodeIds.length" class="virtual-canvas" :style="{ height: `${filteredEpisodeIds.length * ROW_HEIGHT + (canReorder ? 22 : 0)}px` }">
            <div v-if="canReorder && dropIndex != null" class="drop-indicator" :style="{ top: `${dropIndex * ROW_HEIGHT}px` }"><span>{{ t('dropHere') }}</span></div>
            <article
              v-for="row in visibleRows"
              :key="row.episodeId"
              v-ripple
              class="episode-row"
              :class="{ ordered: !!activeTheme, selected: state.selectedEpisodeId === row.episodeId, dragging: state.draggedEpisodeId === row.episodeId }"
              :style="{ transform: `translateY(${row.index * ROW_HEIGHT}px)` }"
              draggable="true"
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
                    :src="getThumbnailUrl(row.episodeId, index)"
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
                  <span>{{ state.library.episodes[row.episodeId]?.layout ?? 'unknown' }}</span>
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
          <div v-else class="empty-state">{{ t('noResults') }}</div>
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
      :title="t('peekSettings')"
      :confirm-button-text="t('save')"
      :cancel-button-text="t('cancel')"
      cancel-button
      @confirm="saveReaderSettings"
    >
      <div class="settings-grid">
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
              <var-button size="small" round text data-reader-settings :aria-label="t('peekSettings')" @click="openReaderSettings"><MdiIcon :path="mdiCogOutline" /></var-button>
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
          <div class="reader-plane" data-reader-plane>
            <img class="reader-image" data-reader-image alt="" draggable="false">
            <img class="reader-image reader-peek" data-reader-peek alt="" draggable="false">
          </div>
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
