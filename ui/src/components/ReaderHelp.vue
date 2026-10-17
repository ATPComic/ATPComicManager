<script setup>
import { ref } from 'vue';
import { mdiHelpCircleOutline } from '../lib/icons.js';
import MdiIcon from './MdiIcon.vue';

defineProps({
  label: { type: String, required: true },
  text: { type: String, required: true }
});

const open = ref(false);
</script>

<template>
  <var-menu v-model:show="open" class="reader-help-menu" trigger="manual" placement="bottom-end" :offset-y="8" popover-class="reader-help-popover">
    <var-button round text :aria-label="label" :title="label" @click="open = !open">
      <MdiIcon :path="mdiHelpCircleOutline" />
    </var-button>
    <template #menu>
      <div class="reader-help-panel">{{ text }}</div>
    </template>
  </var-menu>
</template>

<style>
.reader-help-popover { overflow: hidden !important; border: 1px solid var(--outline); border-radius: 18px !important; background: var(--surface-highest) !important; }
.reader-help-panel { max-width: min(420px, calc(100vw - 32px)); padding: 14px 16px; color: var(--text); font-size: 13px; line-height: 1.6; }
</style>
