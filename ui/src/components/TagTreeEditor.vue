<script setup>
import { reactive, ref } from 'vue';
import { mdiDeleteOutline, mdiDragVertical, mdiTagPlusOutline } from '../lib/icons.js';
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
  // The editor owns the shared tree passed by TagsApp and edits it in place;
  // drag restructuring is reported separately through the restructure event.
  // eslint-disable-next-line vue/no-mutating-props
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

<style>
.tag-node-row .var-field-decorator__controller { background: color-mix(in srgb, var(--tag-container) 22%, var(--surface-highest)); }
.tag-node-row .var-field-decorator__line { border-color: transparent !important; }
.tag-node-row .compact-input, .tag-node-row .compact-input .var-field-decorator,
.tag-node-row .compact-input .var-field-decorator__controller { min-height: 28px; height: 28px; }
.tag-node-row .compact-input .var-field-decorator__controller { padding-block: 0 !important; }

.tag-tree-editor { min-width: 0; margin-top: 0; }
.tag-tree-editor.root { margin-top: 10px; }
.tag-tree-editor.root > .tag-tree-entry + .tag-tree-entry { margin-top: 6px; }
.tag-tree-entry { min-width: 0; position: relative; }
.tag-node-children { display: grid; grid-template-rows: 1fr; }
.tag-node-children > .tag-tree-editor { min-height: 0; overflow: hidden; }
.tag-children-enter-active, .tag-children-leave-active { overflow: hidden; transition: grid-template-rows 180ms cubic-bezier(.2, 0, 0, 1), opacity 140ms ease; }
.tag-children-enter-from, .tag-children-leave-to { grid-template-rows: 0fr; opacity: 0; }
.tag-children-enter-to, .tag-children-leave-from { grid-template-rows: 1fr; opacity: 1; }

.tag-node-row { min-width: 0; min-height: 32px; position: relative; display: grid; grid-template-columns: 16px 20px 40px minmax(108px, 1fr) auto auto; align-items: center; gap: 4px; margin: 0; padding: 2px 2px 2px calc(var(--tag-depth, 0) * 16px); overflow: visible; border-radius: 8px; transition: background-color 140ms ease, box-shadow 140ms ease; }
.tag-node-toggle { width: 16px; height: 16px; display: grid; place-items: center; padding: 0; border: 0; color: var(--muted); background: transparent; cursor: pointer; }
.tag-node-toggle span { width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 6px solid currentColor; transform-origin: 45% 50%; transition: transform 120ms ease; }
.tag-node-toggle.expanded span { transform: rotate(90deg); }
.tag-node-toggle:disabled { opacity: 0; cursor: default; }
.tag-node-toggle:not(:disabled):hover { color: var(--text); }
.tag-node-toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.tag-node-drag { width: 20px; height: 28px; display: grid; place-items: center; border-radius: 7px; color: var(--muted); cursor: grab; touch-action: none; }
.tag-node-drag:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
.tag-node-drag:active { cursor: grabbing; }
.tag-node-drag:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.tag-tree-entry.drop-before > .tag-node-row::before,
.tag-tree-entry.drop-after > .tag-node-row::after { content: ""; position: absolute; z-index: 2; left: 20px; right: 8px; height: 3px; border-radius: 999px; background: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 18%, transparent); }
.tag-tree-entry.drop-before > .tag-node-row::before { top: -5px; }
.tag-tree-entry.drop-after > .tag-node-row::after { bottom: -5px; }
.tag-tree-entry.drop-inside > .tag-node-row { background: color-mix(in srgb, var(--primary-container) 38%, transparent); box-shadow: inset 0 0 0 2px var(--primary); }

.tag-root-drop { min-height: 12px; display: grid; place-items: center; margin: 2px 6px 0; border: 1px dashed transparent; border-radius: 12px; color: transparent; font-size: 11px; transition: min-height 140ms ease, color 140ms ease, border-color 140ms ease, background-color 140ms ease; }
.tag-root-drop.active { min-height: 24px; color: var(--on-primary-container); border-color: var(--primary); background: color-mix(in srgb, var(--primary-container) 45%, transparent); }

.tag-node-row .emoji-input { width: 40px; flex-basis: 40px; }
.tag-node-child-count { min-width: 20px; height: 20px; display: inline-grid; place-items: center; padding-inline: 5px; border-radius: 999px; color: var(--tag-on-container); background: color-mix(in srgb, var(--tag-container) 68%, transparent); font-size: 11px; line-height: 20px; font-variant-numeric: tabular-nums; }
.tag-node-actions { display: inline-flex; align-items: center; gap: 2px; overflow: visible; }
.tag-node-actions .var-button { width: 28px !important; min-width: 28px !important; height: 28px !important; padding: 0 !important; border-radius: 999px !important; }

@media (max-width: 760px) {
  .tag-tree-editor.root { margin-top: 8px; }
  .tag-node-row {
    min-height: 44px;
    grid-template-columns: 24px 28px 36px minmax(72px, 1fr) auto auto;
    gap: 2px;
    padding-block: 2px;
    padding-left: calc(var(--tag-depth, 0) * 10px);
  }
  .tag-node-toggle { width: 24px; height: 40px; }
  .tag-node-drag { width: 28px; height: 40px; }
  .tag-node-row .emoji-input { width: 36px; flex-basis: 36px; }
  .tag-node-row .compact-input, .tag-node-row .compact-input .var-field-decorator,
  .tag-node-row .compact-input .var-field-decorator__controller { min-height: 36px; height: 36px; }
  .tag-node-actions { gap: 0; }
  .tag-node-actions .var-button { width: 36px !important; min-width: 36px !important; height: 36px !important; }
}
</style>
