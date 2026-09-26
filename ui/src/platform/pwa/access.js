import { shallowRef } from 'vue';
import { assetStore } from './assets.js';

export const directoryAccess = shallowRef({ root: null, status: 'unknown', error: '' });
export async function checkDirectoryAccess() {
  const root = await assetStore('directory');
  let status = 'empty';
  if (root) {
    try { status = await root.queryPermission({ mode: 'read' }); }
    catch { status = 'prompt'; }
  }
  directoryAccess.value = { root, status, error: status === 'granted' ? directoryAccess.value.error : '' };
  return status === 'granted';
}
export function reportDirectoryError(error) {
  const name = error?.name ?? error;
  directoryAccess.value = { ...directoryAccess.value, status: ['NotAllowedError', 'SecurityError'].includes(name) ? 'prompt' : directoryAccess.value.status, error: name };
}
export async function restoreDirectoryAccess() {
  // Use the preloaded handle: requestPermission must run during user activation.
  const root = directoryAccess.value.root;
  if (!root || await root.requestPermission({ mode: 'read' }) !== 'granted') return false;
  directoryAccess.value = { root, status: 'granted', error: '' };
  window.dispatchEvent(new Event('pages-assets-restored'));
  for (const image of document.querySelectorAll('img[src*="/__image?"]')) {
    const url = new URL(image.src); url.searchParams.set('retry', Date.now()); image.src = url.href;
  }
  return true;
}
