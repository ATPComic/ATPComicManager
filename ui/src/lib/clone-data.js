import { toRaw } from 'vue';

// Reactive Vue state must be unwrapped before structuredClone so proxies do not
// leak into API request bodies. All app shells share this helper.
export function cloneData(value) {
  return structuredClone(toRaw(value));
}
