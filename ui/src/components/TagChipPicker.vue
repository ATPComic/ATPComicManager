<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import TagCascadeMenu from './TagCascadeMenu.vue';

const HOVER_OPEN_DELAY = 200;
const HOVER_CLOSE_DELAY = 220;
const props = defineProps({
  nodes: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
  categoryStyle: { type: Object, default: () => ({}) },
  counts: { type: Object, default: null }
});

const emit = defineEmits(['update:modelValue']);
const selectedIds = computed(() => new Set(props.modelValue ?? []));
const openPath = ref([]);
let openTimer;
let closeTimer;

function clearTimers() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
}

function scheduleOpen(path, event) {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  if (event?.pointerType === 'touch' || event?.pointerType === 'pen') {
    openPath.value = [...path];
    return;
  }
  openTimer = setTimeout(() => {
    openPath.value = [...path];
  }, HOVER_OPEN_DELAY);
}

function stayOpen() {
  clearTimeout(closeTimer);
}

function scheduleClose() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    openPath.value = [];
  }, HOVER_CLOSE_DELAY);
}

function toggle(value) {
  const next = new Set(props.modelValue);
  next.has(value) ? next.delete(value) : next.add(value);
  clearTimers();
  if (!openPath.value.includes(value)) openPath.value = [];
  emit('update:modelValue', [...next]);
}

onBeforeUnmount(clearTimers);
</script>

<template>
  <div class="tag-assignment-picker tag-chip-picker">
    <TagCascadeMenu
      :nodes="nodes"
      :open-path="openPath"
      :selected-ids="selectedIds"
      :category-style="categoryStyle"
      :counts="counts"
      :root="true"
      @hover-path="scheduleOpen"
      @leave-menu="scheduleClose"
      @stay-menu="stayOpen"
      @select="toggle"
    />
  </div>
</template>
