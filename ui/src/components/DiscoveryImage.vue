<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({ src: { type: String, required: true }, alt: { type: String, default: '' } });
const frame = ref(null);
const active = ref(false);
const ratio = ref(2 / 3);
let observer;
watch(() => props.src, () => { ratio.value = 2 / 3; });
function loaded(event) {
  const image = event.target;
  if (image.naturalWidth && image.naturalHeight) ratio.value = image.naturalWidth / image.naturalHeight;
}
onMounted(() => {
  observer = new IntersectionObserver(([entry]) => { active.value = entry.isIntersecting; }, {
    root: frame.value.closest('.discovery-scroll'), rootMargin: '600px 0px'
  });
  observer.observe(frame.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <span ref="frame" class="discovery-image" :style="{ aspectRatio: ratio }">
    <img v-if="active" :src="src" :alt="alt" loading="lazy" decoding="async" @load="loaded">
  </span>
</template>

<style scoped>
.discovery-image { display: block; width: 100%; background: var(--surface-high); overflow: hidden; }
.discovery-image img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
