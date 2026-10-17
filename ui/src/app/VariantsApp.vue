<script setup>
import PageSkeleton from '../components/PageSkeleton.vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { Dialog, Snackbar } from '@varlet/ui';
import { mdiArrowRight, mdiChevronLeft, mdiContentSaveOutline, mdiDeleteOutline, mdiDragVertical, mdiImageOutline, mdiPencilOutline, mdiPlus, mdiRefresh, mdiRestore, mdiTuneVariant } from '../lib/icons.js';
import MdiIcon from '../components/MdiIcon.vue';
import SettingsMenu from '../components/SettingsMenu.vue';
import { isPagesApp, requestJson } from '../services/api.js';
import { cloneData } from '../lib/clone-data.js';
import { useUnsavedEdits } from '../composables/use-unsaved-edits.js';
import { libraryEpisodePath, returnFromPage, returnPathFromHref } from '../lib/navigation.js';
import { locale, t } from '../../../public/i18n.js';
import { pagesLocalStorageKey } from '../../../public/pages-assets-db.js';
import { getThumbnailUrl } from '../../../public/reader-model.js';
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
} from '../../../public/variant-assignment-model.js';

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

function manualFiles(episodeId) {
  return (state.library.episodes[episodeId]?.files ?? [])
    .map((file, index) => ({ file, index, token: file.assignmentToken }))
    .filter((item) => item.token)
    .sort((left, right) => (
      Number(left.file.sourcePageNumber) - Number(right.file.sourcePageNumber)
      || left.token.localeCompare(right.token)
    ));
}

const episodeIds = computed(() => Object.keys(state.library.episodes)
  .filter((episodeId) => manualFiles(episodeId).length)
  .sort((left, right) => right.localeCompare(left)));

const activeEpisode = computed(() => state.library.episodes[state.selectedEpisodeId] ?? null);
const activeFiles = computed(() => manualFiles(state.selectedEpisodeId));
const fileByToken = computed(() => new Map(activeFiles.value.map((item) => [item.token, item])));
const activeAssignmentMap = computed(() => normalizeEpisodeVariantAssignments(
  state.assignments.episodes[state.selectedEpisodeId]
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
  return normalizeEpisodeVariantAssignments(state.assignments.episodes[episodeId]);
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
    localStorage.setItem(pagesLocalStorageKey(import.meta.env.BASE_URL, 'comic-manager.locale'), value);
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
        <var-button v-if="!isPagesApp" size="small" text :loading="state.busy" @click="rescan"><MdiIcon :path="mdiRefresh" />{{ t('scan') }}</var-button>
        <var-button size="small" type="primary" :disabled="pageLoading" :loading="state.busy" @click="saveAssignments"><MdiIcon :path="mdiContentSaveOutline" />{{ t('saveAssignments') }}</var-button>
        <SettingsMenu v-model="selectedLocale" :options="localeOptions" @change="changeLocale" />
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

<style>
.variant-app-bar { gap: 16px; }
.variant-workspace {
  height: calc(100vh - var(--titlebar-height));
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 0;
  padding: 0;
}

.variant-episode-pane, .variant-board-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 0;
  background: transparent !important;
}
.variant-episode-pane > .var-card__floater,
.variant-board-pane > .var-card__floater,
.variant-episode-pane .var-card__container,
.variant-board-pane .var-card__container,
.variant-episode-pane .var-card__content,
.variant-board-pane .var-card__content {
  min-height: 0;
  height: 100%;
  background: transparent !important;
}
.variant-episode-pane { border-right: 1px solid var(--outline-soft); }
.variant-episode-pane .var-card__content,
.variant-board-pane .var-card__content { display: flex; flex-direction: column; }

.variant-episode-list { min-height: 0; overflow: auto; padding: 0 12px 16px; }
.variant-episode-button { height: 44px; margin-block: 2px; border-radius: 9999px !important; }
.variant-episode-button .var-button__content { width: 100%; justify-content: space-between; gap: 8px; }
.variant-episode-button .var-button__content > span:first-child { min-width: 0; flex: 1; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.variant-episode-button.active { color: var(--on-primary-container) !important; background: var(--primary-container) !important; }

.variant-board-pane > .var-card__floater > .var-card__container > .var-card__content > .pane-heading { min-height: 52px; padding: 6px 14px; }
.variant-board-pane .pane-heading > div:first-child { min-width: 0; }
.variant-board-pane .pane-heading h2 { overflow: hidden; font-size: 17px; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.variant-board-pane .pane-heading .overline { display: none; }
.variant-board-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }

.variant-board {
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: repeat(var(--variant-column-count, 4), minmax(184px, 1fr));
  gap: 8px;
  overflow: auto;
  padding: 0 12px 12px;
}
.variant-column {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--outline-soft);
  border-radius: 20px;
  background: var(--surface-low);
}
.variant-column > header {
  height: 64px;
  flex: 0 0 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 5px 9px;
  border-bottom: 1px solid var(--outline-soft);
}
.variant-column-heading { width: 100%; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.variant-column-heading > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.variant-column-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
.variant-delete-button { width: 28px !important; min-width: 28px !important; height: 28px !important; padding: 0 !important; color: var(--danger) !important; }
.variant-peek-menu { width: 100%; min-width: 0; display: flex; }
.variant-peek-menu > .var-button { width: 100%; }
.variant-peek-trigger {
  width: 100%;
  min-width: 0 !important;
  height: 28px !important;
  justify-content: flex-start !important;
  padding-inline: 7px !important;
  border-radius: 9999px !important;
  color: var(--muted) !important;
  background: color-mix(in srgb, var(--surface-highest) 56%, transparent) !important;
}
.variant-peek-trigger.configured { color: var(--on-secondary-container) !important; background: var(--secondary-container) !important; }
.variant-peek-trigger.none { color: var(--muted) !important; background: transparent !important; box-shadow: inset 0 0 0 1px var(--outline); }
.variant-peek-trigger .var-button__content { width: 100%; min-width: 0; display: flex; align-items: center; gap: 4px; }
.variant-peek-trigger span { flex: 0 0 auto; font-size: 10px; }
.variant-peek-trigger strong { min-width: 0; overflow: hidden; font-size: 10px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }

.variant-name-dialog { display: grid; gap: 7px; padding-top: 4px; }
.variant-name-dialog small { min-height: 18px; padding-inline: 12px; color: var(--muted); font-size: 11px; line-height: 18px; }
.variant-name-dialog small.error { color: var(--danger); }

.variant-column-list {
  position: relative;
  min-width: 0;
  min-height: 112px;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
  padding: 4px 8px 16px;
  transition: background-color 120ms ease;
}
.variant-column-list.active { background: color-mix(in srgb, var(--primary) 8%, transparent); }

.variant-file-card {
  height: 68px;
  display: grid;
  grid-template-columns: 20px 52px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  padding: 8px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 14px;
  background: var(--surface-high);
  cursor: grab;
  user-select: none;
}
.variant-file-card:hover { border-color: var(--outline); background: var(--surface-highest); }
.variant-file-card.dragging { opacity: .38; }
.variant-file-card .drag-handle { cursor: grab; }
.variant-file-card img { width: 52px; height: 52px; display: block; border-radius: 10px; object-fit: cover; background: var(--surface-highest); }
.variant-file-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.variant-file-title { min-width: 0; display: flex; align-items: center; gap: 4px; }
.variant-file-title > strong { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.variant-file-copy strong { font-size: 13px; font-variant-numeric: tabular-nums; }
.variant-file-copy small { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }

.variant-page-button {
  min-width: 38px !important;
  height: 24px !important;
  flex: 0 0 auto;
  padding-inline: 6px !important;
  border-radius: 9999px !important;
  color: var(--muted) !important;
  background: var(--surface-highest) !important;
}
.variant-page-button .var-button__content { display: inline-flex; align-items: center; gap: 2px; font-size: 10px; font-variant-numeric: tabular-nums; }
.variant-page-button.explicit { color: var(--on-secondary-container) !important; background: var(--secondary-container) !important; }
.variant-page-button.duplicate { color: var(--danger) !important; box-shadow: inset 0 0 0 1px var(--danger); }
.variant-page-dialog { display: grid; gap: 12px; padding-top: 4px; }
.variant-page-dialog > strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.variant-page-dialog-footer { min-height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.variant-page-dialog-footer small { color: var(--muted); font-size: 11px; }
.variant-page-dialog-footer small.error { color: var(--danger); }

.variant-insert-line { height: 3px; margin: 0 4px; border-radius: 9999px; background: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 22%, transparent); pointer-events: none; }
.variant-empty-column { min-height: 88px; display: grid; place-items: center; color: var(--muted); font-size: 12px; }

@media (max-width: 900px) {
  .variant-workspace { height: auto; min-height: calc(100vh - var(--titlebar-height)); grid-template-columns: 1fr; }
  .variant-episode-pane { height: 240px; }
  .variant-board-pane { height: 620px; }
  .variant-board { grid-template-columns: repeat(var(--variant-column-count, 4), minmax(184px, 1fr)); }
}

@media (max-width: 760px) {
  .variant-workspace {
    height: calc(100dvh - var(--titlebar-height));
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 128px minmax(0, 1fr);
  }
  .variant-episode-pane, .variant-board-pane { width: 100%; height: auto; min-height: 0; }
  .variant-episode-pane { border-right: 0; border-bottom: 1px solid var(--outline-soft); }
  .variant-episode-pane .pane-heading { min-height: 36px; padding: 4px 10px 0; }
  .variant-episode-pane .pane-heading h2 { font-size: 16px; }
  .variant-episode-list { display: flex; gap: 5px; overflow-x: auto; overflow-y: hidden; padding: 5px 8px 9px; scrollbar-width: none; touch-action: pan-x; }
  .variant-episode-list::-webkit-scrollbar { display: none; }
  .variant-episode-button { width: 150px; min-width: 150px !important; height: 70px; margin: 0; border-radius: 12px !important; }
  .variant-board-pane > .var-card__floater > .var-card__container > .var-card__content > .pane-heading { min-height: 72px; flex-wrap: wrap; align-content: center; padding: 5px 8px; }
  .variant-board-pane .pane-heading > div:first-child { width: 100%; }
  .variant-board-actions { width: 100%; gap: 4px; overflow-x: auto; margin: 0; scrollbar-width: none; }
  .variant-board-actions::-webkit-scrollbar { display: none; }
  .variant-board-actions > * { min-width: max-content; }
  .variant-board-actions .var-button { min-height: 38px; }
  .variant-board {
    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: calc(100vw - max(20px, env(safe-area-inset-left) + env(safe-area-inset-right) + 20px));
    gap: 8px;
    padding: 0 max(10px, env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));
    scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
    touch-action: pan-x;
  }
  .variant-column { border-radius: 14px; scroll-snap-align: center; }
  .variant-column > header { height: 58px; flex-basis: 58px; }
  .variant-column-list { scrollbar-gutter: auto; padding-inline: 6px; touch-action: pan-y; }
  .variant-file-card { height: 76px; grid-template-columns: 60px minmax(0, 1fr); cursor: pointer; }
  .variant-file-card .drag-handle { display: none; }
  .variant-file-card img { width: 60px; height: 60px; }
  .variant-file-card.selected { border-color: var(--primary); background: var(--primary-container); box-shadow: inset 0 0 0 1px var(--primary); }
  .variant-page-button { min-width: 44px !important; height: 36px !important; }
}
</style>
