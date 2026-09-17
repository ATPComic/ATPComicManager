<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({ src: { type: String, required: true }, alt: { type: String, default: '' }, aspectRatio: { type: Number, default: 2 / 3 } });
const frame = ref(null);
const active = ref(false);
const ready = ref(false);
const failed = ref(false);
const retry = ref(0);
function retryImage() { retry.value++; ready.value = false; failed.value = false; }
let observer;
watch([() => props.src, active], () => { ready.value = false; failed.value = false; });
onMounted(() => {
  window.addEventListener('pages-assets-restored', retryImage);
  observer = new IntersectionObserver(([entry]) => { active.value = entry.isIntersecting; }, {
    root: frame.value.closest('.discovery-scroll'), rootMargin: '600px 0px'
  });
  observer.observe(frame.value);
});
onBeforeUnmount(() => { observer?.disconnect(); window.removeEventListener('pages-assets-restored', retryImage); });
</script>

<template>
  <span ref="frame" class="discovery-image" :style="{ aspectRatio }" :aria-busy="active && !ready && !failed">
    <var-skeleton v-if="active && !ready && !failed" class="image-skeleton" :rows="0" card card-height="100%" />
    <img v-if="active" :key="retry" :src="retry && src.includes('/__image?') ? `${src}&retry=${retry}` : src" :alt="alt" :style="{ opacity: ready || failed ? 1 : 0 }" loading="lazy" decoding="async" @load="ready = true" @error="failed = true">
  </span>
</template>

<style scoped>
.discovery-image { position: relative; display: block; width: 100%; background: var(--surface-high); overflow: hidden; }
.discovery-image img, .image-skeleton { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: contain; }
.image-skeleton :deep(.var-skeleton__content) { height: 100%; }
</style>
