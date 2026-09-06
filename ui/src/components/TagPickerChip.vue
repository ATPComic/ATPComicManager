<script setup>
import { computed } from 'vue';
import { mdiCheck, mdiChevronDown, mdiChevronRight, mdiFileTreeOutline } from '../icons.js';
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
  || [props.node?.emoji, props.node?.name].filter(Boolean).join(' ')
  || props.node?.id);
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
