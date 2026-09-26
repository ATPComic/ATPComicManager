import { storageFor } from '../storage/database.js';
import { normalizeRecognitionState } from '../../public/recognition-state.js';

export {
  createEmptyRecognitionState,
  mergeRecognitionStates,
  normalizeRecognitionState
} from '../../public/recognition-state.js';

export { matchesRecognitionRule } from '../../public/recognition-state.js';

export async function loadRecognitionState(databasePath) {
  return storageFor(databasePath).read('recognition');
}

export async function saveRecognitionState(databasePath, input) {
  return storageFor(databasePath).write('recognition', normalizeRecognitionState(input));
}
