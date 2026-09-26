<script setup>
import { ref } from 'vue';
import { tagDefinitionChildren } from '../../../public/tag-model.js';
import { t } from '../../../public/i18n.js';
import { mdiCheck, mdiChevronRight } from '../lib/icons.js';
import MdiIcon from './MdiIcon.vue';
defineOptions({ name: 'TouchTagTree' });
defineProps({ nodes: Array, selectedIds: Set, counts: Object, categoryStyle: Object });
const emit = defineEmits(['select']);
const expanded = ref(new Set());
function toggle(id) { const next = new Set(expanded.value); next.has(id) ? next.delete(id) : next.add(id); expanded.value = next; }
</script>
<template>
  <div class="touch-tag-tree" role="group">
    <div v-for="node in nodes" :key="node.id">
      <div class="touch-tag-row">
        <button v-if="tagDefinitionChildren(node).length" class="touch-tag-expand" :aria-label="t(expanded.has(node.id) ? 'collapseTagChildren' : 'expandTagChildren', { name: node.name || node.id })" :aria-expanded="expanded.has(node.id)" @click.stop="toggle(node.id)"><MdiIcon :path="mdiChevronRight" :class="{ expanded: expanded.has(node.id) }" /></button>
        <span v-else class="touch-tag-spacer" />
        <button class="touch-tag-select" :class="{ selected: selectedIds.has(node.id) }" :style="categoryStyle" role="checkbox" :aria-checked="selectedIds.has(node.id)" @click.stop="emit('select', node.id)"><MdiIcon v-if="selectedIds.has(node.id)" :path="mdiCheck" /><span>{{ [node.emoji, node.name].filter(Boolean).join(' ') || node.id }}</span><small v-if="Number.isFinite(counts?.[node.id])">{{ counts[node.id] }}</small></button>
      </div>
      <Transition name="touch-tags"><TouchTagTree v-if="expanded.has(node.id)" class="touch-tag-children" :nodes="tagDefinitionChildren(node)" :selected-ids="selectedIds" :counts="counts" :category-style="categoryStyle" @select="emit('select', $event)" /></Transition>
    </div>
  </div>
</template>
<style scoped>
.touch-tag-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
.touch-tag-expand, .touch-tag-select { min-height: 44px; border: 0; border-radius: 8px; color: inherit; cursor: pointer; font: inherit; }
.touch-tag-expand { display: grid; place-items: center; width: 44px; flex: 0 0 44px; background: var(--surface-highest); }
.touch-tag-expand svg { transition: transform 180ms ease; }
.touch-tag-expand svg.expanded { transform: rotate(90deg); }
.touch-tag-select { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--surface); text-align: start; }
.touch-tag-select span { overflow-wrap: anywhere; }
.touch-tag-select small { margin-left: auto; opacity: .7; }
.touch-tag-select.selected { background: var(--primary-container); color: var(--on-primary-container); }
.touch-tag-spacer { width: 44px; flex: 0 0 44px; }
.touch-tag-children { margin-left: 16px; }
.touch-tags-enter-active, .touch-tags-leave-active { transition: opacity 150ms ease, transform 150ms ease; }
.touch-tags-enter-from, .touch-tags-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
