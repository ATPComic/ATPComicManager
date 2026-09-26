// Pure recognition-state normalization shared by the Node stores and the
// browser/PWA runtime. Keep this module free of platform imports.

export function createEmptyRecognitionState() {
  return { version: 1, rules: [], episodeDates: {}, identityMarkers: [] };
}

function cleanText(value) {
  return String(value ?? '').trim();
}

// Reject prototype-shaped episode keys so assigning into a plain object cannot
// mutate a prototype when shared JSON is normalized.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function normalizeRecognitionState(input) {
  if (input?.identityMarkers != null && !Array.isArray(input.identityMarkers)) throw new Error('Filename markers must be a list');
  const identityMarkers = [...new Set((input?.identityMarkers ?? []).map(value => String(value).trim().toLowerCase()).filter(Boolean))];
  if (identityMarkers.length > 100 || identityMarkers.some(marker => marker.length > 64 || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(marker))) {
    throw new Error('Use up to 100 filename markers, each up to 64 letters, digits or underscore-separated segments');
  }
  const rules = [];
  const usedIds = new Set();
  for (const [index, value] of (input?.rules ?? []).entries()) {
    const prefix = cleanText(value?.prefix);
    const suffix = cleanText(value?.suffix);
    if (!prefix && !suffix) continue;
    let id = cleanText(value?.id).replace(/[^a-zA-Z0-9_-]/g, '') || `rule-${index + 1}`;
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    rules.push({ id, prefix, suffix });
  }
  const episodeDates = {};
  for (const [episodeId, value] of Object.entries(input?.episodeDates ?? {})) {
    if (UNSAFE_KEYS.has(episodeId)) continue;
    const date = cleanText(value);
    if (episodeId && /^\d{4}-\d{2}-\d{2}$/.test(date)) episodeDates[episodeId] = date;
  }
  return { version: 1, rules, episodeDates, identityMarkers };
}

export function mergeRecognitionStates(current, incoming) {
  const local = normalizeRecognitionState(current);
  const shared = normalizeRecognitionState(incoming);
  const seen = new Set();
  const rules = [...local.rules, ...shared.rules].filter(rule => {
    const key = JSON.stringify([rule.prefix, rule.suffix]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return normalizeRecognitionState({
    rules,
    episodeDates: { ...local.episodeDates, ...shared.episodeDates },
    identityMarkers: [...local.identityMarkers, ...shared.identityMarkers]
  });
}

export { matchesRecognitionRule } from './folder-recognition.js';
