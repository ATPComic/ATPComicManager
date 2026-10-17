<script setup>
import { tagDefinitionChildren } from '../../../public/tag-model.js';
import TagPickerChip from './TagPickerChip.vue';

defineOptions({ name: 'TagCascadeMenu' });

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  path: { type: Array, default: () => [] },
  openPath: { type: Array, default: () => [] },
  selectedIds: { type: Set, required: true },
  categoryStyle: { type: Object, default: () => ({}) },
  counts: { type: Object, default: null },
  root: { type: Boolean, default: false }
});
const emit = defineEmits(['hover-path', 'leave-menu', 'stay-menu', 'select']);
const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;

function children(node) {
  return tagDefinitionChildren(node);
}

function itemPath(node) {
  return [...props.path, node.id];
}

function isOpen(node) {
  const path = itemPath(node);
  return path.every((id, index) => props.openPath[index] === id);
}

function hasSelectedDescendant(node) {
  return children(node).some((child) => props.selectedIds.has(child.id) || hasSelectedDescendant(child));
}

function forwardHover(path, event) {
  emit('hover-path', path, event);
}
</script>

<template>
  <div class="tag-cascade-level" :class="{ root }" role="group">
    <template v-for="node in nodes" :key="node.id">
      <var-menu
        v-if="children(node).length"
        :show="isOpen(node)"
        trigger="manual"
        :placement="root || coarsePointer ? 'bottom-start' : 'right-start'"
        :offset-x="root || coarsePointer ? 0 : 6"
        :offset-y="root || coarsePointer ? 6 : 0"
        popover-class="tag-hover-popover"
      >
        <TagPickerChip
          :node="node"
          :selected="selectedIds.has(node.id)"
          :descendant-selected="hasSelectedDescendant(node)"
          :has-children="true"
          :root="root"
          :count="counts?.[node.id]"
          :category-style="categoryStyle"
          @hover="emit('hover-path', itemPath(node), $event)"
          @leave="emit('leave-menu')"
          @select="emit('select', $event)"
        />
        <template #menu>
          <div class="tag-hover-menu cascade" role="menu" @mouseenter="emit('stay-menu')" @mouseleave="emit('leave-menu')">
            <TagCascadeMenu
              :nodes="children(node)"
              :path="itemPath(node)"
              :open-path="openPath"
              :selected-ids="selectedIds"
              :category-style="categoryStyle"
              :counts="counts"
              @hover-path="forwardHover"
              @leave-menu="emit('leave-menu')"
              @stay-menu="emit('stay-menu')"
              @select="emit('select', $event)"
            />
          </div>
        </template>
      </var-menu>
      <TagPickerChip
        v-else
        :node="node"
        :selected="selectedIds.has(node.id)"
        :count="counts?.[node.id]"
        :category-style="categoryStyle"
        @hover="emit('hover-path', itemPath(node), $event)"
        @leave="emit('leave-menu')"
        @select="emit('select', $event)"
      />
    </template>
  </div>
</template>

<style>
.tag-cascade-level.root { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tag-cascade-level:not(.root) { min-width: 148px; display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
.tag-cascade-level.root > .var-menu { display: inline-flex; flex: 0 0 auto; }
.tag-cascade-level:not(.root) > .var-menu { width: 100%; display: flex; }
.tag-cascade-level:not(.root) > .tag-picker-chip,
.tag-cascade-level:not(.root) > .var-menu > .tag-picker-chip { width: 100%; }
.tag-cascade-level:not(.root) .tag-picker-chip .var-chip__text-small { width: 100%; }
.tag-cascade-level:not(.root) .tag-picker-label { flex: 1; }

.tag-hover-popover { overflow: visible !important; border: 1px solid var(--outline) !important; border-radius: 16px !important; background: var(--surface-highest) !important; box-shadow: 0 6px 18px rgba(0, 0, 0, .38) !important; }
.tag-hover-menu { min-width: 148px; max-width: min(420px, calc(100vw - 32px)); padding: 8px; border-radius: inherit; background: var(--surface-highest); }
.tag-hover-menu .catalog-tag-choice { max-width: 280px; }

@media (max-width: 760px) {
  .tag-hover-menu { max-width: calc(100vw - 16px); }
  .tag-cascade-level:not(.root) { min-width: min(260px, calc(100vw - 32px)); }
}
</style>
