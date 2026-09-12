<script setup>
import PageSkeleton from './components/PageSkeleton.vue';
import { computed, onMounted, reactive, ref, toRaw } from 'vue';
import { Dialog, Snackbar } from '@varlet/ui';
import { mdiArrowRight, mdiChevronLeft, mdiContentSaveOutline, mdiDeleteOutline, mdiDragVertical, mdiImageOutline, mdiPencilOutline, mdiPlus, mdiRefresh, mdiRestore, mdiTuneVariant } from './icons.js';
import MdiIcon from './components/MdiIcon.vue';
import LanguageMenu from './components/LanguageMenu.vue';
import { requestJson } from './api.js';
import { useUnsavedEdits } from './use-unsaved-edits.js';
import { libraryEpisodePath, returnFromPage, returnPathFromHref } from './navigation.js';
import { locale, t } from '../../public/i18n.js';
import { getThumbnailUrl } from '../../public/reader-model.js';
import {
  DEFAULT_VARIANT_NAMES,
  addVariant,
  assignVariantToken,
  createEmptyVariantAssignments,
  createVariantAssignmentDraft,
  findVariantAssignments,
  getEpisodeVariantNames,
  getVariantPageMapping,
  isSpecialVariantName,
  normalizeEpisodeVariantAssignments,
  normalizeVariantName,
  normalizeVariantAssignments,
  removeVariant,
  removeVariantToken,
  setVariantPageMapping
} from '../../public/variant-assignment-model.js';

const state = reactive({
  library: { episodes: {}, warnings: [] },
  assignments: createEmptyVariantAssignments(),
  selectedEpisodeId: null,
  busy: false,
  draggedToken: null,
  draggedSourceVariant: null,
  dropColumn: null,
  dropIndex: null,
  touchToken: null,
  touchSourceVariant: null
});
const selectedLocale = ref(locale);
const edits = useUnsavedEdits(() => JSON.stringify(state.assignments), saveAssignments);
const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
const initialEpisodeId = new URL(window.location.href).searchParams.get('episode');
const AUTOMATIC_PEEK_TARGET = '__automatic__';
const NO_PEEK_TARGET = '__none__';
const addVariantDialogOpen = ref(false);
const variantNameDraft = ref('');
const variantBoard = ref(null);
const expectedScrollTops = new WeakMap();
const pageMappingDialogOpen = ref(false);
const pageMappingDraft = ref('');
const pageMappingTarget = reactive({ variant: null, token: null });

const localeOptions = [
  { label: t('languageEnglish'), value: 'en', ripple: true },
  { label: t('languageJapanese'), value: 'ja', ripple: true },
  { label: t('languageChineseSimplified'), value: 'zh-CN', ripple: true },
  { label: t('languageChineseTraditional'), value: 'zh-TW', ripple: true }
];

function cloneData(value) {
  return structuredClone(toRaw(value));
}

function manualFiles(episodeId) {
  return (state.library.episodes?.[episodeId]?.files ?? [])
    .map((file, index) => ({ file, index, token: file.assignmentToken }))
    .filter((item) => item.token)
    .sort((left, right) => (
      Number(left.file.sourcePageNumber) - Number(right.file.sourcePageNumber)
      || left.token.localeCompare(right.token)
    ));
}

const episodeIds = computed(() => Object.keys(state.library.episodes ?? {})
  .filter((episodeId) => manualFiles(episodeId).length)
  .sort((left, right) => right.localeCompare(left)));

const activeEpisode = computed(() => state.library.episodes?.[state.selectedEpisodeId] ?? null);
const activeFiles = computed(() => manualFiles(state.selectedEpisodeId));
const fileByToken = computed(() => new Map(activeFiles.value.map((item) => [item.token, item])));
const activeAssignmentMap = computed(() => normalizeEpisodeVariantAssignments(
  state.assignments.episodes?.[state.selectedEpisodeId]
));
const activeVariantNames = computed(() => getEpisodeVariantNames(activeAssignmentMap.value));
const columns = computed(() => [null, ...activeVariantNames.value]);
const columnTokenMap = computed(() => {
  const result = new Map();
  const assignedTokens = new Set();
  for (const variant of activeVariantNames.value) {
    const tokens = (activeAssignmentMap.value[variant] ?? []).filter((token) => fileByToken.value.has(token));
    result.set(variant, tokens);
    for (const token of tokens) assignedTokens.add(token);
  }
  const seen = new Set();
  result.set(null, activeFiles.value.flatMap((item) => {
    if (seen.has(item.token) || assignedTokens.has(item.token)) return [];
    seen.add(item.token);
    return [item.token];
  }));
  return result;
});
const variantPageDetails = computed(() => {
  const result = new Map();
  for (const variant of activeVariantNames.value) {
    const details = new Map();
    const pageCounts = new Map();
    for (const [index, token] of columnTokens(variant).entries()) {
      const sourcePageNumber = Number(fileByToken.value.get(token)?.file?.sourcePageNumber);
      const automatic = isSpecialVariantName(variant) && Number.isInteger(sourcePageNumber) && sourcePageNumber > 0
        ? sourcePageNumber
        : index + 1;
      const explicit = getVariantPageMapping(state.assignments, state.selectedEpisodeId, variant, token);
      const resolved = explicit ?? automatic;
      details.set(token, { automatic, explicit, resolved, duplicate: false });
      pageCounts.set(resolved, (pageCounts.get(resolved) ?? 0) + 1);
    }
    for (const detail of details.values()) detail.duplicate = (pageCounts.get(detail.resolved) ?? 0) > 1;
    result.set(variant, details);
  }
  return result;
});
const nonEmptyVariants = computed(() => columns.value
  .filter((variant) => variant && columnTokens(variant).length));
const normalizedVariantNameDraft = computed(() => normalizeVariantName(variantNameDraft.value));
const canAddVariant = computed(() => Boolean(
  normalizedVariantNameDraft.value
  && !activeVariantNames.value.includes(normalizedVariantNameDraft.value)
));
const variantNameFeedback = computed(() => {
  if (!variantNameDraft.value.trim()) return t('variantNameHelp');
  if (!normalizedVariantNameDraft.value) return t('variantNameInvalid');
  if (!canAddVariant.value) return t('variantNameExists');
  return t('variantNameHelp');
});
const pageMappingNumber = computed(() => Number(pageMappingDraft.value));
const canSavePageMapping = computed(() => Number.isInteger(pageMappingNumber.value) && pageMappingNumber.value > 0);

function episodeAssignments(episodeId = state.selectedEpisodeId) {
  return normalizeEpisodeVariantAssignments(state.assignments.episodes?.[episodeId]);
}

function columnTokens(column) {
  return columnTokenMap.value.get(column ?? null) ?? [];
}

function automaticPageNumber(variant, token) {
  return variantPageDetails.value.get(variant)?.get(token)?.automatic ?? null;
}

function explicitPageNumber(variant, token) {
  return variantPageDetails.value.get(variant)?.get(token)?.explicit ?? null;
}

function resolvedPageNumber(variant, token) {
  return variantPageDetails.value.get(variant)?.get(token)?.resolved ?? null;
}

function hasDuplicatePageNumber(variant, token) {
  return variantPageDetails.value.get(variant)?.get(token)?.duplicate ?? false;
}

function unassignedCount(episodeId) {
  const assignments = episodeAssignments(episodeId);
  return manualFiles(episodeId)
    .map((item) => item.token)
    .filter((token, index, values) => values.indexOf(token) === index && !findVariantAssignments(assignments, token).length)
    .length;
}

function automaticPeekTarget(sourceVariant) {
  const index = nonEmptyVariants.value.indexOf(sourceVariant);
  return index >= 0 ? nonEmptyVariants.value[index + 1] ?? null : null;
}

function hasConfiguredPeekTarget(sourceVariant) {
  return Object.hasOwn(
    state.assignments.peekRelations?.[state.selectedEpisodeId] ?? {},
    sourceVariant
  );
}

function configuredPeekTarget(sourceVariant) {
  return state.assignments.peekRelations?.[state.selectedEpisodeId]?.[sourceVariant];
}

function peekTargetSelection(sourceVariant) {
  if (!hasConfiguredPeekTarget(sourceVariant)) return AUTOMATIC_PEEK_TARGET;
  return configuredPeekTarget(sourceVariant) ?? NO_PEEK_TARGET;
}

function peekTargetLabel(sourceVariant) {
  if (hasConfiguredPeekTarget(sourceVariant) && configuredPeekTarget(sourceVariant) === null) {
    return t('peekTargetNone');
  }
  const configured = configuredPeekTarget(sourceVariant);
  if (configured) return configured.toUpperCase();
  const automatic = automaticPeekTarget(sourceVariant);
  return automatic
    ? t('peekTargetAutomaticTo', { variant: automatic.toUpperCase() })
    : t('peekTargetAutomaticNone');
}

function peekTargetOptions(sourceVariant) {
  const automatic = automaticPeekTarget(sourceVariant);
  return [
    {
      label: automatic
        ? t('peekTargetAutomaticTo', { variant: automatic.toUpperCase() })
        : t('peekTargetAutomaticNone'),
      value: AUTOMATIC_PEEK_TARGET,
      ripple: true
    },
    { label: t('peekTargetNone'), value: NO_PEEK_TARGET, ripple: true },
    ...nonEmptyVariants.value
      .filter((variant) => variant !== sourceVariant)
      .map((variant) => ({ label: variant.toUpperCase(), value: variant, ripple: true }))
  ];
}

function setPeekTarget(sourceVariant, value) {
  const episodeId = state.selectedEpisodeId;
  if (!episodeId) return;
  const relations = { ...(state.assignments.peekRelations?.[episodeId] ?? {}) };
  if (value === NO_PEEK_TARGET) relations[sourceVariant] = null;
  else if (value && value !== AUTOMATIC_PEEK_TARGET && value !== sourceVariant) relations[sourceVariant] = value;
  else delete relations[sourceVariant];
  if (!state.assignments.peekRelations) state.assignments.peekRelations = {};
  if (Object.keys(relations).length) state.assignments.peekRelations[episodeId] = relations;
  else delete state.assignments.peekRelations[episodeId];
}

function selectEpisode(episodeId) {
  state.selectedEpisodeId = episodeId;
  if (!state.assignments.episodes[episodeId]) {
    state.assignments.episodes[episodeId] = Object.fromEntries(DEFAULT_VARIANT_NAMES.map((variant) => [variant, []]));
  }
  clearDrag();
  clearTouchSelection();
}

function syncVariantColumnScroll(event) {
  const source = event.currentTarget;
  const expectedTop = expectedScrollTops.get(source);
  if (expectedTop !== undefined) {
    expectedScrollTops.delete(source);
    if (Math.abs(source.scrollTop - expectedTop) < 1) return;
  }

  for (const target of variantBoard.value?.querySelectorAll('.variant-column-list') ?? []) {
    if (target === source) continue;
    const targetRange = Math.max(0, target.scrollHeight - target.clientHeight);
    const targetTop = Math.min(source.scrollTop, targetRange);
    if (Math.abs(target.scrollTop - targetTop) < 1) continue;
    expectedScrollTops.set(target, targetTop);
    target.scrollTop = targetTop;
  }
}

function openPageMappingDialog(variant, token) {
  pageMappingTarget.variant = variant;
  pageMappingTarget.token = token;
  pageMappingDraft.value = String(resolvedPageNumber(variant, token) ?? '');
  pageMappingDialogOpen.value = true;
}

function confirmPageMapping() {
  if (!canSavePageMapping.value || !state.selectedEpisodeId) return;
  state.assignments = cloneData(setVariantPageMapping(
    state.assignments,
    state.selectedEpisodeId,
    pageMappingTarget.variant,
    pageMappingTarget.token,
    pageMappingNumber.value
  ));
}

function resetPageMapping() {
  if (!state.selectedEpisodeId) return;
  state.assignments = cloneData(setVariantPageMapping(
    state.assignments,
    state.selectedEpisodeId,
    pageMappingTarget.variant,
    pageMappingTarget.token,
    null
  ));
  pageMappingDialogOpen.value = false;
}

function startDrag(token, sourceVariant, event) {
  state.draggedToken = token;
  state.draggedSourceVariant = sourceVariant;
  event.dataTransfer?.setData('text/plain', token);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove';
}

function updateDrop(column, event) {
  if (!state.draggedToken) return;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = column && column !== state.draggedSourceVariant ? 'copy' : 'move';
  }
  const items = [...event.currentTarget.querySelectorAll('[data-variant-token]')]
    .filter((item) => item.dataset.variantToken !== state.draggedToken);
  let index = items.length;
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const rect = items[itemIndex].getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      index = itemIndex;
      break;
    }
  }
  state.dropColumn = column ?? 'unassigned';
  state.dropIndex = index;
}

function dropToken(column, event) {
  const token = event.dataTransfer?.getData('text/plain') || state.draggedToken;
  if (!token || !state.selectedEpisodeId) return clearDrag();
  assignToken(token, state.draggedSourceVariant, column, state.dropIndex ?? columnTokens(column).length);
  clearDrag();
}

function assignToken(token, sourceVariant, column, index) {
  if (!token || !state.selectedEpisodeId) return;
  const assignments = episodeAssignments();
  state.assignments.episodes[state.selectedEpisodeId] = column
    ? assignVariantToken(assignments, token, column, index)
    : removeVariantToken(assignments, token, sourceVariant);
  if (!column && sourceVariant) {
    state.assignments = cloneData(setVariantPageMapping(
      state.assignments,
      state.selectedEpisodeId,
      sourceVariant,
      token,
      null
    ));
  }
}

function touchFile(token, column, index) {
  if (!coarsePointer) return;
  if (!state.touchToken) {
    state.touchToken = token;
    state.touchSourceVariant = column;
    return;
  }
  if (state.touchToken === token && state.touchSourceVariant === column) return clearTouchSelection();
  assignToken(state.touchToken, state.touchSourceVariant, column, index);
  clearTouchSelection();
}

function touchColumn(column) {
  if (!state.touchToken) return;
  assignToken(state.touchToken, state.touchSourceVariant, column, columnTokens(column).length);
  clearTouchSelection();
}

function clearTouchSelection() {
  state.touchToken = null;
  state.touchSourceVariant = null;
}

function openAddVariantDialog() {
  if (!state.selectedEpisodeId) return;
  variantNameDraft.value = '';
  addVariantDialogOpen.value = true;
}

function confirmAddVariant() {
  const variant = normalizedVariantNameDraft.value;
  if (!state.selectedEpisodeId || !variant || !canAddVariant.value) return;
  state.assignments.episodes[state.selectedEpisodeId] = addVariant(episodeAssignments(), variant);
}

async function deleteEmptyVariant(variant) {
  const episodeId = state.selectedEpisodeId;
  if (!episodeId || DEFAULT_VARIANT_NAMES.includes(variant) || columnTokens(variant).length) return;
  const action = await Dialog({
    title: t('deleteVariant'),
    message: t('deleteVariantConfirm', { variant: variant.toUpperCase() }),
    cancelButton: true,
    confirmButtonText: t('deleteVariant')
  });
  if (action !== 'confirm') return;

  state.assignments.episodes[episodeId] = removeVariant(episodeAssignments(), variant);
  const relations = Object.fromEntries(Object.entries(state.assignments.peekRelations?.[episodeId] ?? {})
    .filter(([source, target]) => source !== variant && target !== variant));
  if (Object.keys(relations).length) state.assignments.peekRelations[episodeId] = relations;
  else if (state.assignments.peekRelations) delete state.assignments.peekRelations[episodeId];
  state.assignments = cloneData(normalizeVariantAssignments(state.assignments));
}

function clearDrag() {
  state.draggedToken = null;
  state.draggedSourceVariant = null;
  state.dropColumn = null;
  state.dropIndex = null;
}

async function loadState() {
  const scan = await requestJson('/api/scan', { method: 'POST' });
  const payload = await requestJson('/api/state');
  state.library = scan.library ?? payload.library ?? state.library;
  state.assignments = cloneData(createVariantAssignmentDraft(
    payload.variantAssignments ?? createEmptyVariantAssignments(),
    state.library
  ));
  if (initialEpisodeId && episodeIds.value.includes(initialEpisodeId)) state.selectedEpisodeId = initialEpisodeId;
  else if (!episodeIds.value.includes(state.selectedEpisodeId)) state.selectedEpisodeId = episodeIds.value[0] ?? null;
  edits.markSaved();
}

async function rescan() {
  if (state.busy) return;
  if (!await edits.permitLeave()) return;
  state.busy = true;
  try {
    const payload = await requestJson('/api/scan', { method: 'POST', body: '{}' });
    const variants = await requestJson('/api/variants');
    state.library = payload.library ?? state.library;
    state.assignments = cloneData(createVariantAssignmentDraft(variants.variantAssignments, state.library));
    edits.markSaved();
    if (!episodeIds.value.includes(state.selectedEpisodeId)) state.selectedEpisodeId = episodeIds.value[0] ?? null;
    Snackbar.success({ content: t('scanDone'), position: 'bottom' });
  } catch (error) {
    Snackbar.error({ content: error.message, position: 'bottom' });
  } finally {
    state.busy = false;
  }
}

async function saveAssignments() {
  if (state.busy) return;
  state.busy = true;
  try {
    const payload = await requestJson('/api/variants', {
      method: 'PUT',
      body: JSON.stringify(normalizeVariantAssignments(state.assignments))
    });
    state.library = payload.library;
    state.assignments = cloneData(createVariantAssignmentDraft(payload.variantAssignments, state.library));
    edits.markSaved();
    Snackbar.success({ content: t('variantAssignmentsSaved'), position: 'bottom' });
    return true;
  } catch (error) {
    Snackbar.error({ content: error.message, position: 'bottom' });
    return false;
  } finally {
    state.busy = false;
  }
}

function changeLocale(value) {
  return edits.leave(() => {
    localStorage.setItem('comic-manager.locale', value);
    window.location.reload();
  });
}

function goBack() {
  if (state.busy) return;
  return edits.leave(() => {
    if (returnPathFromHref(window.location.href, null)) return returnFromPage('/');
    window.location.assign(libraryEpisodePath(state.selectedEpisodeId));
  });
}

function viewEpisodeInLibrary() {
  if (state.busy) return;
  return edits.leave(() => window.location.assign(libraryEpisodePath(state.selectedEpisodeId)));
}

const pageLoading = ref(true);
onMounted(async () => {
  document.title = t('variantAssignmentTitle');
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
  <div class="variant-page-shell">
    <header class="top-app-bar variant-app-bar">
      <div class="page-app-leading" :title="t('variantAssignmentNote')">
        <var-button round text :aria-label="t('back')" @click="goBack"><MdiIcon :path="mdiChevronLeft" /></var-button>
        <MdiIcon :path="mdiTuneVariant" />
        <h1>{{ t('variantAssignmentTitle') }}</h1>
      </div>
      <div class="top-actions">
        <var-button size="small" text :loading="state.busy" @click="rescan"><MdiIcon :path="mdiRefresh" />{{ t('scan') }}</var-button>
        <var-button size="small" type="primary" :disabled="pageLoading" :loading="state.busy" @click="saveAssignments"><MdiIcon :path="mdiContentSaveOutline" />{{ t('saveAssignments') }}</var-button>
        <LanguageMenu v-model="selectedLocale" :options="localeOptions" :label="t('language')" @change="changeLocale" />
      </div>
    </header>

    <main class="variant-workspace">
      <var-card class="variant-episode-pane" elevation="0">
        <header class="pane-heading"><h2>{{ t('episodes') }}</h2><var-badge :value="episodeIds.length" /></header>
        <div class="variant-episode-list">
          <PageSkeleton v-if="pageLoading" />
          <var-button
            v-for="episodeId in episodeIds"
            :key="episodeId"
            block
            text
            class="variant-episode-button"
            :class="{ active: state.selectedEpisodeId === episodeId }"
            @click="selectEpisode(episodeId)"
          >
            <span>{{ state.library.episodes[episodeId]?.title ?? episodeId }}</span>
            <var-badge :value="unassignedCount(episodeId)" :hidden="!unassignedCount(episodeId)" type="warning" />
          </var-button>
          <div v-if="!pageLoading && !episodeIds.length" class="empty-state">{{ t('noManualVariants') }}</div>
        </div>
      </var-card>

      <var-card class="variant-board-pane" elevation="0">
        <header class="pane-heading">
          <div><span class="overline">{{ t('variantsOverline') }}</span><h2>{{ activeEpisode?.title ?? state.selectedEpisodeId ?? t('noManualVariants') }}</h2></div>
          <div v-if="activeEpisode" class="variant-board-actions">
            <span class="muted">{{ t('manualFileCount', { count: activeFiles.length }) }}</span>
            <var-button size="small" text @click="viewEpisodeInLibrary"><MdiIcon :path="mdiImageOutline" />{{ t('viewEpisodeInLibrary') }}</var-button>
            <var-button size="small" outline @click="openAddVariantDialog"><MdiIcon :path="mdiPlus" />{{ t('addVariant') }}</var-button>
          </div>
        </header>
        <PageSkeleton v-if="pageLoading" />
        <div v-if="activeEpisode" ref="variantBoard" class="variant-board" :style="{ '--variant-column-count': columns.length }">
          <section v-for="column in columns" :key="column ?? 'unassigned'" class="variant-column">
            <header>
              <div class="variant-column-heading">
                <strong>{{ column ? column.toUpperCase() : t('variantUnassigned') }}</strong>
                <div class="variant-column-actions">
                  <var-badge :value="columnTokens(column).length" type="info" />
                  <var-button
                    v-if="column && !DEFAULT_VARIANT_NAMES.includes(column) && !columnTokens(column).length"
                    round
                    text
                    size="small"
                    class="variant-delete-button"
                    :aria-label="t('deleteVariant')"
                    :title="t('deleteVariant')"
                    @click.stop="deleteEmptyVariant(column)"
                  >
                    <MdiIcon :path="mdiDeleteOutline" size="17" />
                  </var-button>
                </div>
              </div>
              <var-menu-select
                v-if="column && columnTokens(column).length"
                class="variant-peek-menu"
                :model-value="peekTargetSelection(column)"
                :options="peekTargetOptions(column)"
                placement="bottom-start"
                size="small"
                @update:model-value="setPeekTarget(column, $event)"
              >
                <var-button
                  class="variant-peek-trigger"
                  :class="{
                    configured: hasConfiguredPeekTarget(column),
                    none: hasConfiguredPeekTarget(column) && configuredPeekTarget(column) === null
                  }"
                  size="small"
                  text
                  :aria-label="t('peekTargetFor', { variant: column.toUpperCase() })"
                  :title="t('peekTargetFor', { variant: column.toUpperCase() })"
                >
                  <span>{{ t('peekTargetShort') }}</span>
                  <MdiIcon :path="mdiArrowRight" size="14" />
                  <strong>{{ peekTargetLabel(column) }}</strong>
                </var-button>
              </var-menu-select>
            </header>
            <div
              class="variant-column-list"
              :class="{ active: state.dropColumn === (column ?? 'unassigned') }"
              @scroll.passive="syncVariantColumnScroll"
              @dragover.prevent="updateDrop(column, $event)"
              @drop.prevent="dropToken(column, $event)"
              @click.self="touchColumn(column)"
            >
              <template v-for="(token, index) in columnTokens(column)" :key="token">
                <div v-if="state.dropColumn === (column ?? 'unassigned') && state.dropIndex === index" class="variant-insert-line"></div>
                <article
                  class="variant-file-card"
                  :class="{
                    dragging: state.draggedToken === token && state.draggedSourceVariant === column,
                    selected: state.touchToken === token && state.touchSourceVariant === column
                  }"
                  :data-variant-token="token"
                  :draggable="!coarsePointer"
                  @dragstart="startDrag(token, column, $event)"
                  @dragend="clearDrag"
                  @click="touchFile(token, column, index)"
                >
                  <MdiIcon class="drag-handle" :path="mdiDragVertical" />
                  <img :src="getThumbnailUrl(state.selectedEpisodeId, fileByToken.get(token).index, fileByToken.get(token).file.assetKey)" alt="" loading="lazy" decoding="async">
                  <div class="variant-file-copy">
                    <div class="variant-file-title">
                      <strong>{{ token }}</strong>
                      <var-button
                        class="variant-page-button"
                        :class="{
                          explicit: explicitPageNumber(column, token) !== null,
                          duplicate: hasDuplicatePageNumber(column, token)
                        }"
                        size="small"
                        text
                        :aria-label="t('editLogicalPage')"
                        :title="t('editLogicalPage')"
                        @click.stop="openPageMappingDialog(column, token)"
                      >
                        <span>#{{ resolvedPageNumber(column, token) }}</span>
                        <MdiIcon :path="mdiPencilOutline" size="13" />
                      </var-button>
                    </div>
                    <small :title="fileByToken.get(token).file.name">{{ fileByToken.get(token).file.name }}</small>
                  </div>
                </article>
              </template>
              <div v-if="state.dropColumn === (column ?? 'unassigned') && state.dropIndex === columnTokens(column).length" class="variant-insert-line"></div>
              <span v-if="!columnTokens(column).length && state.dropColumn !== (column ?? 'unassigned')" class="variant-empty-column" @click="touchColumn(column)">{{ t(coarsePointer ? 'tapFilesHere' : 'dropFilesHere') }}</span>
            </div>
          </section>
        </div>
        <div v-else class="empty-state">{{ t('noManualVariants') }}</div>
      </var-card>
    </main>

    <var-dialog
      v-model:show="pageMappingDialogOpen"
      :title="t('editLogicalPage')"
      :confirm-button-text="t('save')"
      :confirm-button-disabled="!canSavePageMapping"
      :cancel-button-text="t('cancel')"
      cancel-button
      @confirm="confirmPageMapping"
    >
      <div class="variant-page-dialog">
        <strong>{{ t('logicalPageFor', {
          variant: pageMappingTarget.variant?.toUpperCase() ?? '',
          token: pageMappingTarget.token ?? ''
        }) }}</strong>
        <var-input
          v-model="pageMappingDraft"
          class="compact-input"
          type="number"
          min="1"
          step="1"
          size="small"
          variant="outlined"
          autofocus
          :is-show-form-details="false"
          :placeholder="t('logicalPage')"
        />
        <div class="variant-page-dialog-footer">
          <small :class="{ error: pageMappingDraft && !canSavePageMapping }">
            {{ canSavePageMapping
              ? t('automaticPageHint', { page: automaticPageNumber(pageMappingTarget.variant, pageMappingTarget.token) })
              : t('pageNumberInvalid') }}
          </small>
          <var-button
            size="small"
            text
            :disabled="explicitPageNumber(pageMappingTarget.variant, pageMappingTarget.token) === null"
            @click="resetPageMapping"
          >
            <MdiIcon :path="mdiRestore" />
            {{ t('useAutomaticPage') }}
          </var-button>
        </div>
      </div>
    </var-dialog>

    <var-dialog
      v-model:show="addVariantDialogOpen"
      :title="t('addVariant')"
      :confirm-button-text="t('addVariant')"
      :confirm-button-disabled="!canAddVariant"
      :cancel-button-text="t('cancel')"
      cancel-button
      @confirm="confirmAddVariant"
    >
      <div class="variant-name-dialog">
        <var-input
          v-model="variantNameDraft"
          class="compact-input"
          size="small"
          variant="outlined"
          autofocus
          :is-show-form-details="false"
          :placeholder="t('variantNamePrompt')"
        />
        <small :class="{ error: variantNameDraft.trim() && !canAddVariant }">{{ variantNameFeedback }}</small>
      </div>
    </var-dialog>
  </div>
</template>
