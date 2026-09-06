import { withDatabase } from './database.js';

export async function initializeStorage(config) {
  // Schema initialization only. Retired JSON state files are never read.
  withDatabase(config.databasePath, () => {});
  return config.databasePath;
}
