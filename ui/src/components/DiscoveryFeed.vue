<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { discoveryCandidates, discoverySignature, shuffleDiscovery } from '../../../public/discovery-model.js';
import DiscoveryImage from './DiscoveryImage.vue';
import { discoveryColumnCount, discoveryColumnGap, masonryColumns, prepareDiscoveryLayout } from '../lib/discovery-layout.js';
import { countTagEpisodes } from '../../../public/collection-model.js';
import { getImageUrl, getThumbnailUrl } from '../../../public/reader-model.js';
import { t } from '../../../public/i18n.js';
import { mdiChevronLeft, mdiRefresh } from '../lib/icons.js';
import MdiIcon from './MdiIcon.vue';
import TagFilterControl from './TagFilterControl.vue';

const props = defineProps({
  loading: { type: Boolean, default: false },
  library: { type: Object, required: true },
  tags: { type: Object, required: true },
  categoryStyle: { type: Function, required: true },
  episodeLabel: { type: Function, required: true }
});
const emit = defineEmits(['close', 'read']);
const mode = ref('images');
const filters = ref({});
const items = ref([]);
const prepared = ref([]);
const preparing = ref(false);
const scrollRoot = ref(null);
const masonry = ref(null);
const sentinel = ref(null);
const preview = ref(null);
const previewOpen = ref(false);
const containerWidth = ref(0);
const counts = computed(() => countTagEpisodes(Object.keys(props.library.episodes ?? {}), props.tags.episodeTags, props.tags.categories));
const candidates = computed(() => discoveryCandidates(props.library, props.tags, filters.value, mode.value));
const candidateSignature = computed(() => discoverySignature(candidates.value));
const columnCount = computed(() => discoveryColumnCount(containerWidth.value));
const columnGap = computed(() => discoveryColumnGap(containerWidth.value));
const columnWidth = computed(() => {
  const count = columnCount.value;
  if (!count || containerWidth.value <= 0) return 0;
  return Math.max(1, (containerWidth.value - (count - 1) * columnGap.value) / count);
});
const columns = computed(() => masonryColumns(prepared.value, columnCount.value, columnWidth.value, columnGap.value));
let observer;
let resizeObserver;
let preparation;
const dimensionCache = new Map();

async function prepareMore() {
  if (preparing.value || prepared.value.length >= items.value.length) return;
  const controller = new AbortController();
  preparation = controller;
  preparing.value = true;
  const start = prepared.value.length;
  const end = start + 12;
  try {
    const batch = await prepareDiscoveryLayout(items.value.slice(start, end), { signal: controller.signal, cache: dimensionCache });
    if (!controller.signal.aborted) prepared.value = [...prepared.value, ...batch];
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    if (preparation === controller) preparing.value = false;
  }
}

function refresh() {
  preparation?.abort();
  preparing.value = false;
  prepared.value = [];
  items.value = shuffleDiscovery(candidates.value);
  void prepareMore();
  nextTick(() => scrollRoot.value?.scrollTo({ top: 0 }));
}
function open(item) {
  if (item.readable) emit('read', item);
  else {
    preview.value = item;
    previewOpen.value = true;
  }
}
function more() { void prepareMore(); }
watch(candidateSignature, refresh, { immediate: true });
onMounted(() => {
  containerWidth.value = masonry.value?.clientWidth ?? 0;
  observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) more();
  }, { root: scrollRoot.value, rootMargin: '500px' });
  observer.observe(sentinel.value);
  resizeObserver = new ResizeObserver(([entry]) => { containerWidth.value = entry.contentRect.width; });
  resizeObserver.observe(masonry.value);
});
onBeforeUnmount(() => { observer?.disconnect(); resizeObserver?.disconnect(); preparation?.abort(); });
</script>

<template>
  <section class="discovery" :aria-label="t('discover')">
    <header class="discovery-toolbar">
      <var-button round text :aria-label="t('back')" @click="emit('close')"><MdiIcon :path="mdiChevronLeft" /></var-button>
      <h2>{{ t('discover') }}</h2>
      <var-button-group size="small" mode="outline" :elevation="false" :aria-label="t('discoveryMode')">
        <var-button outline :type="mode === 'images' ? 'primary' : 'default'" :aria-pressed="mode === 'images'" @click="mode = 'images'">{{ t('discoveryImages') }}</var-button>
        <var-button outline :type="mode === 'covers' ? 'primary' : 'default'" :aria-pressed="mode === 'covers'" @click="mode = 'covers'">{{ t('discoveryCovers') }}</var-button>
      </var-button-group>
      <TagFilterControl v-model="filters" :categories="tags.categories" :category-style="categoryStyle" :counts="counts" />
      <var-button round text :aria-label="t('discoveryRefresh')" :title="t('discoveryRefresh')" @click="refresh"><MdiIcon :path="mdiRefresh" /></var-button>
    </header>
    <div ref="scrollRoot" class="discovery-scroll">
      <div ref="masonry" class="discovery-masonry" :style="{ '--discovery-gap': `${columnGap}px`, gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }">
        <div v-for="(column, columnIndex) in columns" :key="columnIndex" class="discovery-column">
          <button v-for="item in column" :key="JSON.stringify([item.episodeId, item.index])" class="discovery-card" type="button" @click="open(item)">
            <DiscoveryImage :src="getThumbnailUrl(item.episodeId, item.index, item.file.assetKey, 'preview')" :alt="item.file.name" :aspect-ratio="item.aspectRatio" />
            <span class="discovery-caption">{{ episodeLabel(item.episodeId) }}</span>
          </button>
        </div>
      </div>
      <p v-if="!loading && !items.length" class="empty-state">{{ t('noResults') }}</p>
      <div ref="sentinel" class="discovery-more">
        <var-skeleton v-if="preparing || loading" :rows="1" />
        <var-button v-if="prepared.length < items.length" :loading="preparing" text @click="more">{{ t('discoveryMore') }}</var-button>
      </div>
    </div>
    <var-dialog v-model:show="previewOpen" :title="preview?.file.name" :confirm-button-text="t('back')" width="min(960px, calc(100vw - 24px))">
      <img v-if="previewOpen && preview" class="discovery-preview" :src="getImageUrl(preview.episodeId, preview.index, preview.file.assetKey)" :alt="preview.file.name">
    </var-dialog>
  </section>
</template>

<style scoped>
:global(.app-shell.discovery-active) { display: flex; flex-direction: column; }
:global(.discovery-active > .top-app-bar) { flex-shrink: 0; }
.discovery { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.discovery-toolbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; flex-wrap: wrap; }
.discovery-toolbar h2 { font-size: 18px; margin: 0 auto 0 0; }
.discovery-scroll { overflow-y: auto; flex: 1; min-height: 0; padding: 0 16px; }
.discovery-masonry { display: grid; align-items: start; column-gap: var(--discovery-gap); }
.discovery-column { display: flex; flex-direction: column; gap: var(--discovery-gap); min-width: 0; }
.discovery-card { display: block; width: 100%; padding: 0; margin: 0; border: 0; border-radius: 8px; overflow: hidden; background: var(--surface); color: inherit; cursor: pointer; text-align: left; font: inherit; }
.discovery-card:focus-visible { outline: 3px solid var(--primary); outline-offset: 2px; }
.discovery-caption { display: block; padding: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.discovery-toolbar :deep(.var-button-group .var-button), .discovery-toolbar :deep(.query-filter-trigger) { height: 40px; font-size: 14px; }
.discovery-more { text-align: center; padding: 16px; }
.discovery-preview { display: block; max-width: 100%; max-height: 72dvh; margin: auto; object-fit: contain; }
@media (max-width: 600px) {
  .discovery-toolbar { gap: 8px; padding: 8px; }
  .discovery-toolbar h2 { flex: 1; }
  .discovery-toolbar :deep(.var-button-group) { order: 1; width: 100%; }
  .discovery-toolbar :deep(.var-button-group .var-button) { flex: 1; }
  .discovery-scroll { padding: 0 8px; }
}
</style>
