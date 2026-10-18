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

<style>
.reader-progress-row { min-height: 52px; display: grid; grid-template-columns: 28px minmax(0, 1fr) 64px; align-items: center; gap: 10px; padding: 7px 16px 9px; color: var(--muted); background: #1d1e22; border-top: 1px solid var(--outline-soft); font-size: 11px; transition: opacity 180ms ease, visibility 180ms ease; }
.reader-page-progress { grid-area: page; }
.reader-episode-progress { grid-area: episode; }
.reader-progress-icon { justify-self: center; color: #c3c5cc; }
.reader-progress-row output { text-align: right; font-variant-numeric: tabular-nums; }
.reader-slider-control {
  width: 100%;
  min-width: 0;
  --md-sys-color-primary: var(--primary);
  --md-sys-color-on-primary: #10254a;
  --md-sys-color-on-surface: var(--text);
  --md-sys-color-on-surface-variant: var(--muted);
  --md-sys-color-surface-container-highest: var(--surface-highest);
  --md-slider-handle-shadow-color: #000;
  --md-slider-active-track-height: 10px;
  --md-slider-inactive-track-height: 10px;
  --md-slider-handle-width: 7px;
  --md-slider-handle-height: 30px;
  --md-slider-handle-shape: 9999px;
  --md-slider-with-tick-marks-container-size: 3px;
}

.reader.is-fullscreen .reader-progress-row { position: absolute; z-index: 7; left: 16px; right: 88px; width: auto; opacity: 0; visibility: hidden; transform: none; pointer-events: none; }
.reader.is-fullscreen .reader-page-progress { bottom: 12px; }
.reader.is-fullscreen .reader-episode-progress { bottom: 72px; }
.reader.is-fullscreen.is-chrome-visible .reader-progress-row { opacity: 1; visibility: visible; pointer-events: auto; }

@media (orientation: landscape) and (min-width: 840px) {
  .reader-progress-row,
  .reader.is-fullscreen .reader-progress-row {
    position: absolute;
    z-index: 7;
    top: 50%;
    right: auto;
    bottom: auto;
    width: calc(100dvh - 88px);
    min-height: 52px;
    padding: 7px 12px 9px;
    border: 1px solid var(--outline-soft);
    border-radius: var(--md-sys-shape-corner-full, 9999px);
    background: color-mix(in srgb, #1d1e22 88%, transparent);
    backdrop-filter: blur(14px);
    transform: translate(-50%, -50%) rotate(90deg);
    transform-origin: center;
  }
  .reader-episode-progress,
  .reader.is-fullscreen .reader-episode-progress { left: 32px; }
  .reader-page-progress,
  .reader.is-fullscreen .reader-page-progress { left: calc(100% - 32px); }
  .reader-progress-icon,
  .reader-progress-row output { transform: rotate(-90deg); }
  .reader-progress-row output { justify-self: stretch; text-align: center; line-height: 1.2; }
  .reader-episode-progress .reader-slider-control::part(label) { transform: rotate(-90deg); }
  .reader-page-progress .reader-slider-control { transform: scaleY(-1); }
  .reader-page-progress .reader-slider-control::part(label) { transform: scaleY(-1) rotate(-90deg); }
  .reader.is-fullscreen .reader-progress-row { opacity: 0; visibility: hidden; pointer-events: none; }
  .reader.is-fullscreen.is-chrome-visible .reader-progress-row { opacity: 1; visibility: visible; pointer-events: auto; }
}

@media (max-width: 760px) {
  .reader-progress-row { min-height: 48px; grid-template-columns: 24px minmax(0, 1fr) 56px; gap: 5px; padding: 5px 8px; }
  .reader.is-fullscreen .reader-progress-row { left: max(8px, env(safe-area-inset-left)); right: max(72px, calc(env(safe-area-inset-right) + 72px)); }
  .reader.is-fullscreen .reader-page-progress { bottom: calc(8px + env(safe-area-inset-bottom)); }
  .reader.is-fullscreen .reader-episode-progress { bottom: calc(62px + env(safe-area-inset-bottom)); }
}

@media (max-width: 760px) and (orientation: portrait) {
  .reader-progress-row { min-height: 48px; }
}

@media (max-width: 760px) {
  .reader-progress-row { position: relative; top: auto; left: auto; right: auto; bottom: auto; width: auto; transform: none; min-height: 48px; }
  .reader-progress-icon, .reader-progress-row output, .reader-slider-control { transform: none; }
  .reader.is-fullscreen .reader-progress-row { top: auto; left: 8px; right: 8px; width: auto; transform: none; }
  .reader-page-progress { padding-bottom: max(8px, env(safe-area-inset-bottom)); }
}
</style>
