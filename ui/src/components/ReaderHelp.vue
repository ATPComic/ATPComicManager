<script setup>
import { ref } from 'vue';
import { mdiHelpCircleOutline } from '../icons.js';
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
