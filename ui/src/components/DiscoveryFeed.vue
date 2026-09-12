<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { discoveryCandidates, shuffleDiscovery } from '../../../public/discovery-model.js';
import { countTagEpisodes } from '../../../public/collection-model.js';
import { getImageUrl, getThumbnailUrl } from '../../../public/reader-model.js';
import { t } from '../../../public/i18n.js';
import { mdiChevronLeft, mdiRefresh } from '../icons.js';
import MdiIcon from './MdiIcon.vue';
import TagFilterControl from './TagFilterControl.vue';

const props = defineProps({
  library: { type: Object, required: true },
  tags: { type: Object, required: true },
  categoryStyle: { type: Function, required: true },
  episodeLabel: { type: Function, required: true }
});
const emit = defineEmits(['close', 'read']);
const mode = ref('images');
const filters = ref({});
const items = ref([]);
const limit = ref(60);
const scrollRoot = ref(null);
const sentinel = ref(null);
const preview = ref(null);
const previewOpen = ref(false);
const visible = computed(() => items.value.slice(0, limit.value));
const batches = computed(() => {
  const result = [];
  for (let index = 0; index < visible.value.length; index += 60) result.push(visible.value.slice(index, index + 60));
  return result;
});
const counts = computed(() => countTagEpisodes(Object.keys(props.library.episodes ?? {}), props.tags.episodeTags, props.tags.categories));
const candidates = computed(() => discoveryCandidates(props.library, props.tags, filters.value, mode.value));
let observer;

function refresh() {
  items.value = shuffleDiscovery(candidates.value);
  limit.value = 60;
  nextTick(() => scrollRoot.value?.scrollTo({ top: 0 }));
}
function open(item) {
  if (item.readable) emit('read', item);
  else {
    preview.value = item;
    previewOpen.value = true;
  }
}
function more() { limit.value += 60; }
watch(candidates, refresh, { immediate: true });
onMounted(() => {
  observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) more();
  }, { root: scrollRoot.value, rootMargin: '500px' });
  observer.observe(sentinel.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <section class="discovery" :aria-label="t('discover')">
    <header class="discovery-toolbar">
      <var-button round text :aria-label="t('back')" @click="emit('close')"><MdiIcon :path="mdiChevronLeft" /></var-button>
      <h2>{{ t('discover') }}</h2>
      <var-button-group size="small" mode="outline" :elevation="false" :aria-label="t('discoveryMode')">
        <var-button :type="mode === 'images' ? 'primary' : 'default'" :aria-pressed="mode === 'images'" @click="mode = 'images'">{{ t('discoveryImages') }}</var-button>
        <var-button :type="mode === 'covers' ? 'primary' : 'default'" :aria-pressed="mode === 'covers'" @click="mode = 'covers'">{{ t('discoveryCovers') }}</var-button>
      </var-button-group>
      <TagFilterControl v-model="filters" :categories="tags.categories" :category-style="categoryStyle" :counts="counts" />
      <var-button round text :aria-label="t('discoveryRefresh')" :title="t('discoveryRefresh')" @click="refresh"><MdiIcon :path="mdiRefresh" /></var-button>
    </header>
    <div ref="scrollRoot" class="discovery-scroll">
      <div v-for="(batch, batchIndex) in batches" :key="batchIndex" class="discovery-masonry">
        <button v-for="item in batch" :key="JSON.stringify([item.episodeId, item.index])" class="discovery-card" type="button" @click="open(item)">
          <img :src="getThumbnailUrl(item.episodeId, item.index, item.file.assetKey)" :alt="item.file.name" loading="lazy" decoding="async">
          <span>{{ episodeLabel(item.episodeId) }}</span>
        </button>
      </div>
      <p v-if="!items.length" class="empty-state">{{ t('noResults') }}</p>
      <div ref="sentinel" class="discovery-more">
        <var-button v-if="limit < items.length" text @click="more">{{ t('discoveryMore') }}</var-button>
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
.discovery-masonry { columns: 5 220px; column-gap: 12px; }
.discovery-card { display: block; width: 100%; padding: 0; margin: 0 0 12px; break-inside: avoid; border: 0; border-radius: 8px; overflow: hidden; background: var(--surface); color: inherit; cursor: pointer; text-align: left; font: inherit; }
.discovery-card:focus-visible { outline: 3px solid var(--primary); outline-offset: 2px; }
.discovery-card img { width: 100%; height: auto; min-height: 80px; display: block; }
.discovery-card span { display: block; padding: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.discovery-more { text-align: center; padding: 16px; }
.discovery-preview { display: block; max-width: 100%; max-height: 72dvh; margin: auto; object-fit: contain; }
@media (max-width: 600px) {
  .discovery-toolbar { gap: 8px; padding: 8px; }
  .discovery-toolbar h2 { flex: 1; }
  .discovery-toolbar :deep(.var-button-group) { order: 1; width: 100%; }
  .discovery-toolbar :deep(.var-button-group .var-button) { flex: 1; }
  .discovery-masonry { columns: 2; column-gap: 8px; }
  .discovery-scroll { padding: 0 8px; }
}
</style>
