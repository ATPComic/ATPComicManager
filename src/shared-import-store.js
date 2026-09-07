import { storageFor } from './storage/database.js';
import { normalizeRecognitionState } from './recognition-store.js';
import { normalizeSharedThemes } from './themes/store.js';

export function normalizeSharedImport(input) {
  const source = input?.export && typeof input.export === 'object' ? input.export : input;
  if (!source || typeof source !== 'object' || !source.library || !source.tags || !source.variants) {
    throw new Error('Unsupported JSON: expected library, tags, and variants');
  }
  return { library: source.library, tags: source.tags, variants: source.variants, recognition: normalizeRecognitionState(source.recognition), themes: normalizeSharedThemes(source.themes) };
}

export async function loadSharedImport(databasePath) {
  return storageFor(databasePath).read('shared');
}

export async function saveSharedImport(databasePath, input) {
  return storageFor(databasePath).write('shared', normalizeSharedImport(input));
}
