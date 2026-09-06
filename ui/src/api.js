import { Capacitor, registerPlugin } from '@capacitor/core';
import missingImageUrl from '../../public/missing-image.svg?url';

const AtpLibrary = registerPlugin('AtpLibrary');

export const isAndroidApp = Capacitor.getPlatform() === 'android';

export function nativeAssetUrl(file) {
  if (file?.missing) return missingImageUrl;
  return file?.androidUri ? Capacitor.convertFileSrc(file.androidUri) : null;
}

export async function chooseAndroidLibrary(copyToApp = false) {
  if (!isAndroidApp) return null;
  return AtpLibrary.chooseDirectory({ copyToApp });
}

export async function requestJson(url, options = {}) {
  if (isAndroidApp) {
    if (url === '/api/state' && (!options.method || options.method === 'GET')) return AtpLibrary.getState();
    throw new Error(`This operation is unavailable on Android: ${url}`);
  }
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }

  return response.json();
}
