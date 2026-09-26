import { themePalette, rgb } from '../public/theme-palette.js';

const linear = hex => rgb(hex).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function luminance(hex) {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function oklch(hex) {
  const [r, g, b] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const v = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, v), h: (Math.atan2(v, a) * 180 / Math.PI + 360) % 360 };
}

export function report() {
  for (const color of ['#79e6bf', themePalette.primary]) {
    console.log(color, { ...oklch(color), luminance: luminance(color), onSurface: contrast(color, '#303238') });
  }
  for (const role of ['primary', 'primary-container', 'info', 'info-container']) {
    const ratio = contrast(themePalette[role], themePalette[`on-${role}`]);
    console.log(role, ratio.toFixed(2), ratio >= 4.5 ? 'AA pass' : 'FAIL');
    if (ratio < 4.5) process.exitCode = 1;
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/check-theme.mjs')) report();
