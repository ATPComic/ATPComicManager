import { storageFor } from './storage/database.js';
import {
  normalizeVariantAssignments
} from '../public/variant-assignment-model.js';

export async function loadVariantAssignments(databasePath) {
  return storageFor(databasePath).read('variants');
}

export async function saveVariantAssignments(databasePath, input) {
  return storageFor(databasePath).write('variants', normalizeVariantAssignments(input));
}
