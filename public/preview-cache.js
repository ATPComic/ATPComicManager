export function previewCacheEntry(value, clear = false) {
  const blobs = [value?.thumbnails?.preview?.blob, value?.preview].filter(blob => typeof blob?.size === 'number');
  const bytes = blobs.reduce((total, blob) => total + blob.size, 0);
  if (!clear || !blobs.length) return { bytes, count: blobs.length, value };
  const next = { ...value, thumbnails: { ...value.thumbnails } };
  delete next.thumbnails.preview;
  delete next.preview;
  delete next.fingerprint;
  return { bytes, count: blobs.length, value: next };
}
