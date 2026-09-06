import { storageFor } from './storage/database.js';

export function createEmptyRecognitionState() {
  return { version: 1, rules: [], episodeDates: {}, identityMarkers: [] };
}

function cleanText(value) {
  return String(value ?? '').trim();
}

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
    const date = cleanText(value);
    if (episodeId && /^\d{4}-\d{2}-\d{2}$/.test(date)) episodeDates[episodeId] = date;
  }
  return { version: 1, rules, episodeDates, identityMarkers };
}

export function matchesRecognitionRule(folderName, rules) {
  const name = String(folderName ?? '');
  return (rules ?? []).some((rule) => (
    (!rule.prefix || name.startsWith(rule.prefix))
    && (!rule.suffix || name.endsWith(rule.suffix))
  ));
}

export async function loadRecognitionState(databasePath) {
  return storageFor(databasePath).read('recognition');
}

export async function saveRecognitionState(databasePath, input) {
  return storageFor(databasePath).write('recognition', normalizeRecognitionState(input));
}
