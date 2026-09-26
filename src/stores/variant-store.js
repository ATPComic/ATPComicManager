import { storageFor } from './storage/database.js';
import { parseImageFilename, parseUndatedImageFilename } from './validation/filename.js';
import {
  normalizeVariantAssignments
} from '../public/variant-assignment-model.js';

export async function loadVariantAssignments(databasePath) {
  return storageFor(databasePath).read('variants');
}

export function alignVariantTokens(input, library, identityMarkers = []) {
  const state = normalizeVariantAssignments(input);
  for (const [id, episode] of Object.entries(library?.episodes ?? {})) {
    const replacements = new Map();
    const actualTokens = new Set();
    for (const file of episode.files ?? []) {
      if (file.missing) continue;
      const parsed = /^\d{8}$/.test(id) ? parseImageFilename(file.name, identityMarkers) : parseUndatedImageFilename(file.name, identityMarkers);
      if (!parsed) continue;
      actualTokens.add(parsed.assignmentToken);
      if (file.assignmentToken && file.assignmentToken !== parsed.assignmentToken) {
        const candidates = replacements.get(file.assignmentToken) ?? new Set();
        candidates.add(parsed.assignmentToken);
        replacements.set(file.assignmentToken, candidates);
      }
    }
    for (const [oldToken, candidates] of replacements) {
      if (actualTokens.has(oldToken) || candidates.size !== 1) continue;
      const [newToken] = candidates;
      for (const [variant, tokens] of Object.entries(state.episodes[id] ?? {})) {
        state.episodes[id][variant] = [...new Set(tokens.map(token => token === oldToken ? newToken : token))];
        const mappings = state.pageMappings?.[id]?.[variant];
        if (mappings && Object.hasOwn(mappings, oldToken)) {
          mappings[newToken] ??= mappings[oldToken];
          delete mappings[oldToken];
        }
      }
    }
  }
  return state;
}

export async function saveVariantAssignments(databasePath, input) {
  return storageFor(databasePath).write('variants', normalizeVariantAssignments(input));
}
