import { themePresets } from './theme-presets.js';
export { themePresets };
export const themePalette = themePresets.green;

export function rgb(hex) {
  return hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
}

export function hsl(hex) {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  const hue = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return `${hue * 60}, ${saturation * 100}%, ${lightness * 100}%`;
}
