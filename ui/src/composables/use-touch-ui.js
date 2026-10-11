import { onBeforeUnmount, ref } from 'vue';

// Input modality is derived from real pointer events, never from a media query.
// Viewport/device-metric changes (e.g. DevTools emulation) then cannot flip the
// UI between mouse and touch styles - only an actual touch/mouse event can.
export function useTouchUi() {
  const query = window.matchMedia?.('(pointer: coarse)');
  const touch = ref(query?.matches ?? false);
  const onPointerDown = (event) => {
    if (event.pointerType) touch.value = event.pointerType !== 'mouse';
  };
  window.addEventListener('pointerdown', onPointerDown, true);
  onBeforeUnmount(() => window.removeEventListener('pointerdown', onPointerDown, true));
  return touch;
}
