export const supportedLocales = ['en', 'ja', 'zh-CN', 'zh-TW'];

export function normalizeSystemLocale(value) {
  const candidate = String(value ?? '').toLowerCase().replaceAll('_', '-');
  if (candidate.startsWith('en')) return 'en';
  if (candidate.startsWith('ja')) return 'ja';
  if (!candidate.startsWith('zh')) return null;
  return /(?:^|-)(?:tw|hk|mo|hant)(?:-|$)/.test(candidate) ? 'zh-TW' : 'zh-CN';
}

export function resolveLocale({ storedLocale, systemLocales = [] } = {}) {
  if (supportedLocales.includes(storedLocale)) return storedLocale;
  for (const value of systemLocales) {
    const normalized = normalizeSystemLocale(value);
    if (normalized) return normalized;
  }
  return 'en';
}

export function detectLocale({ storage = globalThis.localStorage, navigator = globalThis.navigator } = {}) {
  const storedLocale = storage?.getItem?.('comic-manager.locale');
  const systemLocales = navigator?.languages?.length
    ? navigator.languages
    : navigator?.language
      ? [navigator.language]
      : [];
  return resolveLocale({ storedLocale, systemLocales });
}
