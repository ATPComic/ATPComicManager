<script setup>
import { computed, ref } from 'vue';
import { mdiCalendarRange, mdiChevronDown, mdiCloseCircleOutline } from '../icons.js';
import { t } from '../../../public/i18n.js';
import MdiIcon from './MdiIcon.vue';

const props = defineProps({ modelValue: { type: Object, required: true } });
const emit = defineEmits(['update:modelValue', 'change']);
const open = ref(false);
const active = computed(() => Boolean(props.modelValue.start || props.modelValue.end));
const pickerType = computed(() => props.modelValue.granularity === 'day' ? 'date' : props.modelValue.granularity);
const pickerValue = computed(() => [props.modelValue.start, props.modelValue.end].filter(Boolean));

function update(key, value) {
  const next = { ...props.modelValue, [key]: value };
  if (key === 'granularity') {
    next.start = '';
    next.end = '';
  }
  emit('update:modelValue', next);
  emit('change');
}

function clear() {
  emit('update:modelValue', { granularity: props.modelValue.granularity || 'month', start: '', end: '' });
  emit('change');
}

function updateRange(value) {
  const range = Array.isArray(value) ? value : value ? [value] : [];
  emit('update:modelValue', {
    ...props.modelValue,
    start: range[0] ?? '',
    end: range[1] ?? ''
  });
  emit('change');
}
</script>

<template>
  <var-menu v-model:show="open" placement="bottom-end" :offset-y="8" popover-class="date-filter-popover">
    <var-button class="query-filter-trigger date-filter-trigger" :class="{ active }" size="small" outline aria-haspopup="menu" :aria-expanded="open">
      <MdiIcon :path="mdiCalendarRange" /><span>{{ t('dateFilter') }}</span><MdiIcon class="filter-chevron" :path="mdiChevronDown" />
    </var-button>
    <template #menu>
      <section class="date-filter-panel">
        <header><strong>{{ t('dateRange') }}</strong><var-button v-if="active" round text :aria-label="t('clearDateFilter')" @click="clear"><MdiIcon :path="mdiCloseCircleOutline" /></var-button></header>
        <div class="date-granularity" role="group" :aria-label="t('dateGranularity')">
          <var-button v-for="item in ['year', 'month', 'day']" :key="item" size="small" :type="modelValue.granularity === item ? 'primary' : 'default'" :outline="modelValue.granularity !== item" @click="update('granularity', item)">{{ t(`dateGranularity_${item}`) }}</var-button>
        </div>
        <var-date-picker
          class="date-range-picker"
          :model-value="pickerValue"
          :type="pickerType"
          range
          :show-title="false"
          :elevation="false"
          @update:model-value="updateRange"
        />
      </section>
    </template>
  </var-menu>
</template>
