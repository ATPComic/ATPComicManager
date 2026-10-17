<script setup>
import { computed } from 'vue';
import { mdiCheck, mdiChevronDown, mdiChevronRight, mdiFileTreeOutline } from '../lib/icons.js';
import MdiIcon from './MdiIcon.vue';

const props = defineProps({
  node: { type: Object, required: true },
  label: { type: String, default: '' },
  selected: { type: Boolean, default: false },
  descendantSelected: { type: Boolean, default: false },
  hasChildren: { type: Boolean, default: false },
  root: { type: Boolean, default: false },
  count: { type: Number, default: null },
  categoryStyle: { type: Object, default: () => ({}) }
});
const emit = defineEmits(['select', 'hover', 'leave']);

const text = computed(() => props.label
  || [props.node.emoji, props.node.name].filter(Boolean).join(' ')
  || props.node.id);
</script>

<template>
  <var-chip
    v-ripple
    class="catalog-tag-choice tag-picker-chip"
    :class="{ selected, 'has-selected-child': descendantSelected && !selected, 'has-children': hasChildren }"
    :style="categoryStyle"
    size="small"
    role="checkbox"
    tabindex="0"
    :aria-checked="selected"
    :aria-haspopup="hasChildren ? 'menu' : undefined"
    :title="text"
    @mouseenter="emit('hover', $event)"
    @pointerdown="emit('hover', $event)"
    @focus="emit('hover', $event)"
    @mouseleave="emit('leave')"
    @blur="emit('leave')"
    @click.stop="emit('select', node.id)"
    @keydown.enter.space.prevent="emit('select', node.id)"
  >
    <MdiIcon v-if="descendantSelected" class="tag-choice-state branch" :path="mdiFileTreeOutline" size="16" />
    <MdiIcon v-else-if="selected" class="tag-choice-state" :path="mdiCheck" size="16" />
    <span class="tag-picker-label">{{ text }}</span>
    <span v-if="Number.isFinite(count)" class="tag-episode-count">{{ count }}</span>
    <MdiIcon v-if="hasChildren" class="tag-choice-chevron" :path="root ? mdiChevronDown : mdiChevronRight" size="15" />
  </var-chip>
</template>

<style>
.catalog-tag-choice {
  --chip-small-padding: 0 8px;
  --chip-text-small-margin: 0;
  --chip-border-radius: 8px;
  color: var(--muted) !important;
  border: 1px solid var(--outline) !important;
  background: transparent !important;
}
.catalog-tag-choice.selected {
  color: var(--tag-on-container) !important;
  border-color: transparent !important;
  background: var(--tag-container) !important;
  box-shadow: none;
}
.catalog-tag-choice.has-selected-child {
  color: var(--tag-on-container) !important;
  border-color: color-mix(in srgb, var(--tag-accent) 76%, transparent) !important;
  background: color-mix(in srgb, var(--tag-container) 45%, transparent) !important;
}

.tag-picker-chip { min-width: 0; max-width: 100%; cursor: pointer; user-select: none; }
.tag-picker-chip:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.tag-picker-chip .var-chip__text-small { min-width: 0; display: inline-flex; align-items: center; gap: 5px; overflow: hidden; }
.tag-picker-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag-choice-state { flex: 0 0 auto; }
.tag-choice-state.branch { color: var(--tag-accent); }
.tag-choice-chevron { flex: 0 0 auto; margin-left: 1px; opacity: .78; }
.tag-episode-count { min-width: 18px; height: 18px; flex: 0 0 auto; display: inline-grid; place-items: center; padding: 0 5px; border-radius: 9999px; background: color-mix(in srgb, currentColor 12%, transparent); font-size: 11px; line-height: 18px; font-variant-numeric: tabular-nums; }
</style>
