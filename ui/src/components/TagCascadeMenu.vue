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
