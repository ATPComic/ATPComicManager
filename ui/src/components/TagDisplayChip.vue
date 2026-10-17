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
  if (props.path.length) return props.path;
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

<style>
.catalog-tag-chip {
  --chip-normal-padding: 0 8px;
  --chip-small-padding: 0 8px;
  --chip-text-normal-margin: 0;
  --chip-text-small-margin: 0;
  --chip-border-radius: 8px;
  color: var(--tag-on-container) !important;
  border: 1px solid color-mix(in srgb, var(--tag-accent) 72%, transparent) !important;
  background: color-mix(in srgb, var(--tag-container) 58%, transparent) !important;
}

.tag-display-chip { max-width: 100%; overflow: hidden; }
.tag-display-chip .var-chip__text-small,
.tag-display-chip .var-chip__text-normal { min-width: 0; overflow: hidden; }
.tag-display-path { min-width: 0; display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }
.tag-display-segment { min-width: 0; display: inline-flex; align-items: center; }
.tag-display-segment.ancestor { font-size: .78em; opacity: .78; }
.tag-display-emoji { flex: 0 0 auto; font-family: "Segoe UI Emoji", "Apple Color Emoji", sans-serif; }
.tag-display-name {
  max-width: 0;
  margin-left: 0;
  overflow: hidden;
  opacity: 0;
  text-overflow: ellipsis;
  transition: max-width 220ms cubic-bezier(.2, 0, 0, 1), margin-left 220ms cubic-bezier(.2, 0, 0, 1), opacity 140ms ease;
}
.tag-display-name.visible { max-width: 10rem; margin-left: 0; opacity: 1; }
.tag-display-separator { margin: 0 1px; opacity: .72; }
.tag-display-chip:hover .tag-display-name,
.tag-display-chip:focus-visible .tag-display-name,
.tag-display-chip:focus-within .tag-display-name { max-width: 12rem; margin-left: 4px; opacity: 1; }

@media (pointer: coarse) {
  .tag-display-name { max-width: 10rem; opacity: 1; }
  .tag-display-segment:not(:first-child) .tag-display-name { margin-left: 3px; }
}
</style>
