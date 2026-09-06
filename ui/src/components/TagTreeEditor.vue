<script setup>
import { reactive, ref } from 'vue';
import { mdiDeleteOutline, mdiDragVertical, mdiTagPlusOutline } from '../icons.js';
import { t } from '../../../public/i18n.js';
import MdiIcon from './MdiIcon.vue';

defineOptions({ name: 'TagTreeEditor' });

const TAG_DRAG_TYPE = 'application/x-comic-manager-tag';
const props = defineProps({
  nodes: { type: Array, required: true },
  categoryId: { type: String, required: true },
  depth: { type: Number, default: 0 }
});
const emit = defineEmits(['restructure']);
const dropTarget = ref(null);
const collapsedNodeIds = reactive(new Set(
  props.nodes.filter((node) => node.values?.length).map((node) => node.id)
));

function createStableId() {
  return `tag-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function addChild(node) {
  if (!Array.isArray(node.values)) node.values = [];
  node.values.push({ id: createStableId(), emoji: '', name: '', values: [] });
  collapsedNodeIds.delete(node.id);
}

function toggleNode(node) {
  if (!node.values?.length) return;
  if (collapsedNodeIds.has(node.id)) collapsedNodeIds.delete(node.id);
  else collapsedNodeIds.add(node.id);
}

function removeNode(index) {
  props.nodes.splice(index, 1);
}

function startDrag(node, event) {
  const payload = JSON.stringify({ categoryId: props.categoryId, nodeId: node.id });
  event.dataTransfer?.setData(TAG_DRAG_TYPE, payload);
  event.dataTransfer?.setData('text/plain', payload);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function acceptsTag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes(TAG_DRAG_TYPE);
}

function nodePlacement(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
  if (ratio < 0.28) return 'before';
  if (ratio > 0.72) return 'after';
  return 'inside';
}

function updateNodeDrop(node, event) {
  if (!acceptsTag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTarget.value = { nodeId: node.id, placement: nodePlacement(event) };
}

function updateRootDrop(event) {
  if (!acceptsTag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTarget.value = { nodeId: null, placement: 'end' };
}

function readSource(event) {
  try {
    return JSON.parse(event.dataTransfer?.getData(TAG_DRAG_TYPE) ?? '');
  } catch {
    return null;
  }
}

function finishDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const source = readSource(event);
  const target = dropTarget.value;
  dropTarget.value = null;
  if (!source || !target) return;
  emit('restructure', {
    source,
    target: { categoryId: props.categoryId, nodeId: target.nodeId, placement: target.placement }
  });
}
</script>

<template>
  <div class="tag-tree-editor" :class="{ root: depth === 0 }" :style="{ '--tag-depth': depth }">
    <div
      v-for="(node, index) in nodes"
      :key="node.id || index"
      class="tag-tree-entry"
      :class="{
        'drop-before': dropTarget?.nodeId === node.id && dropTarget?.placement === 'before',
        'drop-inside': dropTarget?.nodeId === node.id && dropTarget?.placement === 'inside',
        'drop-after': dropTarget?.nodeId === node.id && dropTarget?.placement === 'after'
      }"
    >
      <div class="tag-node-row" @dragover="updateNodeDrop(node, $event)" @drop="finishDrop" @dragleave.self="dropTarget = null">
        <button
          type="button"
          class="tag-node-toggle"
          :class="{ expanded: node.values?.length && !collapsedNodeIds.has(node.id) }"
          :disabled="!node.values?.length"
          :aria-expanded="node.values?.length ? !collapsedNodeIds.has(node.id) : undefined"
          :aria-label="node.values?.length ? (collapsedNodeIds.has(node.id) ? t('expandTag') : t('collapseTag')) : undefined"
          @click="toggleNode(node)"
        ><span aria-hidden="true"></span></button>
        <span
          class="tag-node-drag"
          draggable="true"
          role="button"
          tabindex="0"
          :aria-label="t('dragTag')"
          :title="t('dragTag')"
          @dragstart="startDrag(node, $event)"
          @dragend="dropTarget = null"
        ><MdiIcon :path="mdiDragVertical" /></span>
        <var-input
          v-model="node.emoji"
          class="compact-input emoji-input"
          :class="{ 'is-empty': !node.emoji }"
          size="small"
          variant="outlined"
          :hint="false"
          :is-show-form-details="false"
          placeholder="☺︎"
          :aria-label="t('tagEmoji')"
        />
        <var-input v-model="node.name" class="compact-input" size="small" variant="outlined" :hint="false" :is-show-form-details="false" :placeholder="t('tagName')" />
        <span v-if="node.values?.length" class="tag-node-child-count" :aria-label="t('childTagCount', { count: node.values.length })">{{ node.values.length }}</span>
        <div class="tag-node-actions">
          <var-button round text icon-container size="small" :aria-label="t('addChildTag')" :title="t('addChildTag')" @click="addChild(node)"><MdiIcon :path="mdiTagPlusOutline" /></var-button>
          <var-button round text icon-container size="small" class="danger-action" :aria-label="t('deleteTag')" :title="t('deleteTag')" @click="removeNode(index)"><MdiIcon :path="mdiDeleteOutline" /></var-button>
        </div>
      </div>
      <Transition name="tag-children">
        <div v-if="node.values?.length && !collapsedNodeIds.has(node.id)" class="tag-node-children">
          <TagTreeEditor
            :nodes="node.values"
            :category-id="categoryId"
            :depth="depth + 1"
            @restructure="emit('restructure', $event)"
          />
        </div>
      </Transition>
    </div>
    <div
      v-if="depth === 0"
      class="tag-root-drop"
      :class="{ active: dropTarget?.placement === 'end' }"
      @dragover="updateRootDrop"
      @drop="finishDrop"
      @dragleave.self="dropTarget = null"
    >{{ t('dropAtCategoryRoot') }}</div>
  </div>
</template>
