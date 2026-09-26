import { requestJson } from '../api.js';
import { downloadJsonFile } from '../download.js';

export async function downloadLibraryBackup() {
  const payload = await requestJson('/api/export/json', { method: 'POST', body: '{}' });
  downloadJsonFile(payload.export, `ATP-Comic-backup-${new Date().toISOString().slice(0, 10)}.json`);
}
