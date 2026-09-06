<script setup>
import { computed } from 'vue';
import { mdiTranslate } from '../icons.js';
import MdiIcon from './MdiIcon.vue';

const props = defineProps({
  modelValue: { type: String, required: true },
  options: { type: Array, default: () => [] },
  label: { type: String, required: true }
});

const emit = defineEmits(['update:modelValue', 'change']);
const currentLabel = computed(() => (
  props.options.find((option) => option.value === props.modelValue)?.label ?? props.modelValue
));

function selectLocale(value) {
  emit('update:modelValue', value);
  emit('change', value);
}
</script>

<template>
  <var-menu-select
    class="language-menu"
    :model-value="modelValue"
    :options="options"
    placement="bottom-end"
    size="small"
    @update:model-value="selectLocale"
  >
    <var-button
      round
      text
      size="small"
      class="language-trigger"
      :aria-label="label"
      :title="`${label}: ${currentLabel}`"
      aria-haspopup="menu"
    >
      <MdiIcon :path="mdiTranslate" />
    </var-button>
  </var-menu-select>
</template>
