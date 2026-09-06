<script setup>
import { computed, useAttrs } from 'vue';
import { normalizeTagDefinition } from '../../../public/tag-model.js';

defineOptions({ inheritAttrs: false });
const props = defineProps({
  path: { type: Array, default: () => [] },
  fallback: { type: String, default: '' },
  closeable: { type: Boolean, default: false },
  size: { type: String, default: 'small' }
});
const emit = defineEmits(['close']);
const attrs = useAttrs();

const segments = computed(() => {
  if (props.path?.length) return props.path;
  const fallback = normalizeTagDefinition({ id: props.fallback, name: props.fallback });
  return fallback.id ? [fallback] : [];
});
const fullLabel = computed(() => segments.value
  .map((segment) => [segment.emoji, segment.name].filter(Boolean).join(' ') || segment.id)
  .join(' › '));
</script>

<template>
  <var-chip
    v-bind="attrs"
    class="catalog-tag-chip tag-display-chip"
    :size="size"
    :closeable="closeable"
    tabindex="0"
    :aria-label="fullLabel"
    :title="fullLabel"
    @close="emit('close', $event)"
  >
    <span class="tag-display-path">
      <span
        v-for="(segment, index) in segments"
        :key="segment.id || index"
        class="tag-display-segment"
        :class="{ ancestor: index < segments.length - 1 }"
      >
        <span v-if="segment.emoji" class="tag-display-emoji">{{ segment.emoji }}</span>
        <span v-if="segment.name" class="tag-display-name" :class="{ visible: !segment.emoji }">{{ segment.name }}</span>
        <span v-if="index < segments.length - 1" class="tag-display-separator">›</span>
      </span>
    </span>
  </var-chip>
</template>
