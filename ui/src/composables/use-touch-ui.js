import { onBeforeUnmount, ref } from 'vue';

export function useTouchUi() {
  const query = window.matchMedia('(pointer: coarse), (max-width: 760px) and (orientation: portrait)');
  const touch = ref(query.matches);
  const update = () => { touch.value = query.matches; };
  query.addEventListener('change', update);
  onBeforeUnmount(() => query.removeEventListener('change', update));
  return touch;
}
