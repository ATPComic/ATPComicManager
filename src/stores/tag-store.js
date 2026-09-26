import { storageFor } from '../storage/database.js';
import { normalizeTagState } from '../../public/tag-state.js';

export {
  createEmptyTagState,
  mergeTagMaps,
  mergeTagStates,
  normalizeCategoryColor,
  normalizeTagMap,
  normalizeTagState
} from '../../public/tag-state.js';

export async function loadTagState(databasePath) {
  return storageFor(databasePath).read('tags');
}

export async function saveTagState(databasePath, value) {
  return storageFor(databasePath).write('tags', normalizeTagState(value));
}
