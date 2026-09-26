import { matchArchiveFolderName, matchesRecognitionRule } from '../../../../public/folder-recognition.js';
import { datedFileIdentity, parseImageFilename, parseUndatedImageFilename, sortImageFileRecords } from '../../../../public/filename.js';
import { applyVariantAssignments } from '../../../../public/variant-assignments.js';

export function scanDirectoryRecords(files, previous, namespace) {
  const recognition = previous.recognition;
  const episodes = {};
  const knownFolders = new Map();
  for (const [id, episode] of Object.entries(previous.library.episodes)) {
    if (episode.layout !== 'rule-folder') continue;
    for (const file of episode.files) {
      if (file.assetKey?.startsWith(`${namespace}:`)) knownFolders.set(file.assetKey.slice(namespace.length + 1).split('/').slice(0, -1).join('/'), id);
    }
  }
  for (const file of files) {
    const relativePath = file.webkitRelativePath.split('/').slice(1).join('/');
    const folder = file.webkitRelativePath.split('/').at(-2);
    const sourceKey = relativePath.split('/').slice(0, -1).join('/');
    const match = matchArchiveFolderName(folder);
    const undated = !match && matchesRecognitionRule(folder, recognition.rules);
    const parsed = undated ? parseUndatedImageFilename(file.name, recognition.identityMarkers) : parseImageFilename(file.name, recognition.identityMarkers);
    if (!parsed) continue;
    const id = undated ? knownFolders.get(sourceKey) ?? `folder:${sourceKey || folder}` : match?.date ?? parsed.episodeId;
    const layout = undated ? 'rule-folder' : match?.layout ?? 'month-flat';
    const episode = episodes[id] ??= { layout, title: undated ? folder : undefined, sourceKey, date: undated ? recognition.episodeDates?.[id] ?? null : id, files: [], variants: {}, warnings: [], errors: [], peekRelations: {} };
    episode.files.push({ name: file.name, relativePath, assetKey: `${namespace}:${relativePath}`, sourceLayout: layout,
      ...(undated ? { assignmentToken: parsed.assignmentToken, sourcePageNumber: parsed.pageNumber } : {}) });
  }
  // Keep shared placeholders and manual metadata when a source disappears.
  for (const [id, old] of Object.entries(previous.library.episodes)) {
    const episode = episodes[id];
    if (!episode) { episodes[id] = { ...old, missing: true, files: old.files.map(file => ({ ...file, missing: true })) }; continue; }
    const present = new Set(episode.files.map(file => file.relativePath));
    const assets = new Set(episode.files.map(file => file.assetKey));
    const identities = new Set(episode.files.map(file => /^\d{8}$/.test(id) ? datedFileIdentity(file, recognition.identityMarkers) : file.assignmentToken));
    for (const file of old.files) {
      const identity = /^\d{8}$/.test(id) ? datedFileIdentity(file, recognition.identityMarkers) : file.assignmentToken;
      if (!present.has(file.relativePath) && !assets.has(file.assetKey) && !(identity && identities.has(identity))) episode.files.push({ ...file, missing: true });
    }
  }
  const library = { episodes, warnings: [] };
  applyVariantAssignments(library, previous.variantAssignments, recognition.identityMarkers);
  for (const episode of Object.values(episodes)) episode.files = sortImageFileRecords(episode.files);
  return library;
}
