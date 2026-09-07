import { createHash } from 'node:crypto';

export function attachImageReferences(library) {
  for (const [id, episode] of Object.entries(library.episodes ?? {})) {
    for (const file of episode.files ?? []) {
      file.assetKey = createHash('sha256').update(JSON.stringify([id, file.absolutePath ?? null, file.source ?? null, file.relativePath ?? null, file.name, Boolean(file.missing)])).digest('hex');
    }
  }
  return library;
}

export function resolveImageReference(episode, searchParams) {
  const key = searchParams.get('file');
  const index = Number(searchParams.get('index') ?? 0);
  const indexed = Number.isInteger(index) && index >= 0 ? episode?.files?.[index] : undefined;
  if (key !== null) return indexed?.assetKey === key ? indexed : episode?.files?.find(file => file.assetKey === key);
  return indexed;
}
