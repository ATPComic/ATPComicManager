<script setup>
import { computed, ref } from 'vue';
import { t } from '../../../public/i18n.js';

const AUTOMATIC_PEEK_TARGET = '__automatic__';
const NO_PEEK_TARGET = '__none__';
const emit = defineEmits(['select', 'peek-target']);
const variants = ref([]);
const activeVariant = ref('');
const automaticPeekTarget = ref(null);
const temporaryPeekTarget = ref(undefined);

const peekSelection = computed(() => {
  if (temporaryPeekTarget.value === undefined) return AUTOMATIC_PEEK_TARGET;
  return temporaryPeekTarget.value === null ? NO_PEEK_TARGET : temporaryPeekTarget.value;
});
const peekOptions = computed(() => [
  {
    label: automaticPeekTarget.value
      ? t('peekTargetAutomaticTo', { variant: automaticPeekTarget.value.toUpperCase() })
      : t('peekTargetAutomaticNone'),
    value: AUTOMATIC_PEEK_TARGET,
    ripple: true
  },
  { label: t('peekTargetNone'), value: NO_PEEK_TARGET, ripple: true },
  ...variants.value
    .filter((variant) => variant !== activeVariant.value)
    .map((variant) => ({ label: variant.toUpperCase(), value: variant, ripple: true }))
]);
const peekTargetLabel = computed(() => {
  if (temporaryPeekTarget.value === null) return t('peekTargetNone');
  if (temporaryPeekTarget.value) return temporaryPeekTarget.value.toUpperCase();
  return automaticPeekTarget.value
    ? t('peekTargetAutomaticTo', { variant: automaticPeekTarget.value.toUpperCase() })
    : t('peekTargetAutomaticNone');
});

function setState(state = {}) {
  const previousActive = activeVariant.value;
  variants.value = state.variants ?? [];
  activeVariant.value = state.active ?? '';
  const activeIndex = variants.value.indexOf(activeVariant.value);
  const orderedDefault = activeIndex >= 0 ? variants.value[activeIndex + 1] ?? null : null;
  const defaultKey = ['defaultPeekTarget', 'automaticPeekTarget', 'configuredPeekTarget']
    .find((key) => Object.hasOwn(state, key));
  automaticPeekTarget.value = defaultKey
    ? state[defaultKey] || null
    : state.peekTarget ?? orderedDefault;

  if (Object.hasOwn(state, 'peekTargetOverride')) {
    temporaryPeekTarget.value = state.peekTargetOverride;
  } else if (Object.hasOwn(state, 'temporaryPeekTarget')) {
    temporaryPeekTarget.value = state.temporaryPeekTarget;
  } else if (previousActive !== activeVariant.value) {
    temporaryPeekTarget.value = undefined;
  }
}

function selectVariant(value) {
  if (value && value !== activeVariant.value) emit('select', value);
}

function selectPeekTarget(value) {
  temporaryPeekTarget.value = value === AUTOMATIC_PEEK_TARGET
    ? undefined
    : value === NO_PEEK_TARGET
      ? null
      : value;
  emit('peek-target', temporaryPeekTarget.value);
}

defineExpose({ setState });
</script>

<template>
  <div class="reader-variants">
    <div class="reader-variant-left"><slot name="left" /></div>
    <var-segmented-buttons
      class="reader-variant-buttons"
      :model-value="activeVariant"
      :options="variants.map((variant) => ({ label: variant.toUpperCase(), value: variant, ripple: true }))"
      :checkmark="false"
      size="small"
      :aria-label="t('variantSelector')"
      @update:model-value="selectVariant"
    />
    <div class="reader-variant-right">
      <var-menu-select
        v-if="variants.length > 1"
        class="reader-peek-target-menu"
        size="small"
        :model-value="peekSelection"
        :options="peekOptions"
        placement="bottom"
        @update:model-value="selectPeekTarget"
      >
        <var-button
          class="reader-peek-target-trigger"
          :class="{
            overridden: temporaryPeekTarget !== undefined,
            none: temporaryPeekTarget === null
          }"
          size="small"
          text
          :aria-label="t('temporaryPeekTarget')"
          :title="t('temporaryPeekTarget')"
        >
          <strong>{{ peekTargetLabel }}</strong>
        </var-button>
      </var-menu-select>
    </div>
  </div>
</template>
