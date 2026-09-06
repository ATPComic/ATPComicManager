<script setup>
import { onBeforeUnmount, ref } from 'vue';
import '@material/web/slider/slider.js';
import MdiIcon from './MdiIcon.vue';

const props = defineProps({
  iconPath: { type: String, required: true },
  ariaLabel: { type: String, required: true },
  hidden: { type: Boolean, default: false }
});

const emit = defineEmits(['input']);
const current = ref(1);
const total = ref(1);
const isHidden = ref(props.hidden);
const dragging = ref(false);

let inputFrame = 0;
let pendingInput = null;

function clampValue(value) {
  return Math.min(total.value, Math.max(1, Math.round(Number(value) || 1)));
}

function flushInput() {
  cancelAnimationFrame(inputFrame);
  inputFrame = 0;
  if (pendingInput == null) return;
  const value = pendingInput;
  pendingInput = null;
  emit('input', value);
}

function scheduleInput(value) {
  pendingInput = value;
  if (inputFrame) return;
  inputFrame = requestAnimationFrame(flushInput);
}

function setCurrent(value, emitInput = true) {
  const next = clampValue(value);
  if (next === current.value) return;
  current.value = next;
  if (emitInput) scheduleInput(next);
}

function setState(state = {}) {
  total.value = Math.max(1, Number(state.total) || 1);
  if (!dragging.value) setCurrent(state.current, false);
  else current.value = clampValue(current.value);
  isHidden.value = state.hidden ?? false;
}

function onInteractionStart() {
  dragging.value = true;
}

function eventValue(event) {
  const hostValue = Number(event.currentTarget.value);
  if (Number.isFinite(hostValue)) return hostValue;
  const nativeInput = event.composedPath().find((element) => (
    element instanceof HTMLInputElement && element.type === 'range'
  ));
  if (Number.isFinite(nativeInput?.valueAsNumber)) return nativeInput.valueAsNumber;
  const shadowValue = Number(event.currentTarget.shadowRoot?.querySelector('input[type="range"]')?.value);
  return Number.isFinite(shadowValue) ? shadowValue : current.value;
}

function onSliderInput(event) {
  dragging.value = true;
  setCurrent(eventValue(event));
}

function onInteractionEnd(event) {
  setCurrent(eventValue(event));
  dragging.value = false;
  flushInput();
}

onBeforeUnmount(() => cancelAnimationFrame(inputFrame));
defineExpose({ setState });
</script>

<template>
  <div v-if="!isHidden" class="reader-progress-row">
    <MdiIcon class="reader-progress-icon" :path="iconPath" />
    <md-slider
      class="reader-slider-control"
      labeled
      :min="1"
      :max="Math.max(2, total)"
      :value.prop="current"
      :disabled="total <= 1"
      :step="1"
      :aria-label="ariaLabel"
      @pointerdown="onInteractionStart"
      @pointerup="onInteractionEnd"
      @pointercancel="onInteractionEnd"
      @input="onSliderInput"
      @change="onInteractionEnd"
    ></md-slider>
    <output>{{ current }} / {{ total }}</output>
  </div>
</template>
