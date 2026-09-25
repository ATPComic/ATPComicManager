import { requestJson } from '../api.js';

export async function downloadLibraryBackup() {
  const payload = await requestJson('/api/export/json', { method: 'POST', body: '{}' });
  const blob = new Blob([`${JSON.stringify(payload.export, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ATP-Comic-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
