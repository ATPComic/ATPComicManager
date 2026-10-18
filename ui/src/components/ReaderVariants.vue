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

<style>
.reader-variants {
  width: min(620px, 52vw);
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(104px, 1fr) auto minmax(104px, 1fr);
  align-items: center;
  justify-self: center;
  gap: 8px;
}
.reader-variant-left { min-width: 0; justify-self: end; }
.reader-variant-right { min-width: 0; justify-self: start; }
.reader-variant-buttons { min-width: 0; overflow-x: auto; scrollbar-width: none; }
.reader-variant-buttons::-webkit-scrollbar { display: none; }
.reader-variants .var-segmented-button { min-width: 40px; }
.reader-peek-target-menu { display: inline-flex; flex: 0 0 auto; }
.reader-peek-target-trigger {
  min-width: 64px !important;
  max-width: 112px;
  height: 32px !important;
  padding-inline: 9px !important;
  border-radius: 9999px !important;
  color: var(--muted) !important;
  background: var(--surface-high) !important;
}
.reader-peek-target-trigger.overridden { color: var(--on-secondary-container) !important; background: var(--secondary-container) !important; }
.reader-peek-target-trigger.none { color: var(--muted) !important; background: var(--surface-high) !important; box-shadow: inset 0 0 0 1px var(--outline); }
.reader-peek-target-trigger .var-button__content { min-width: 0; display: inline-flex; align-items: center; gap: 4px; }
.reader-peek-target-trigger strong { max-width: 94px; overflow: hidden; font-size: 11px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 760px) {
  .reader-variants { grid-column: 1 / -1; grid-row: 2; width: 100%; min-width: 0; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr); gap: 4px; }
  .reader-variant-left { justify-self: start; }
  .reader-variant-right { justify-self: end; }
  .reader-variant-buttons { max-width: 100%; justify-self: center; }
  .reader-peek-target-trigger { min-width: 72px !important; height: 40px !important; }
  .reader-variants .var-segmented-button { min-width: 44px; min-height: 40px; }
}
</style>
