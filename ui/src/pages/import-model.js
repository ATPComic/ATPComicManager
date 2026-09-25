import { portableLibrary, assertPortableJson } from '../../../src/shared-export.js';
import { normalizeVariantAssignments } from '../../../public/variant-assignment-model.js';
import { isImageFile, datedFileIdentity, compareDatedSourcePriority } from '../../../src/validation/filename.js';
import { matchArchiveFolderName } from '../../../public/folder-recognition.js';

export async function collectDirectoryFiles(directory, progress = () => {}) {
  const files = [];
  const pending = [{ handle: directory, prefix: directory.name }];
  async function walk(handle, prefix) {
    for await (const entry of handle.values()) {
      const path = `${prefix}/${entry.name}`;
      if (entry.kind === 'directory') {
        if (!entry.name.startsWith('.') && !['Reading', 'node_modules', 'themes'].includes(entry.name)) pending.push({ handle: entry, prefix: path });
      } else if (isImageFile(entry.name)) {
        files.push({ name: entry.name, webkitRelativePath: path, handle: entry });
        if (files.length % 128 === 0) progress(files.length, 0);
      }
    }
  }
  // Enumerate handles only, with bounded parallelism for slow document providers.
  while (pending.length) await Promise.all(pending.splice(0, 4).map(({ handle, prefix }) => walk(handle, prefix)));
  return files;
}

export function readSharedCatalog(input) {
  const source = input?.export ?? input;
  if (!source?.library?.episodes || !Array.isArray(source?.tags?.categories) || !source.variants) throw new Error('pagesInvalidImport');
  assertPortableJson(source);
  return {
    library: { ...portableLibrary(source.library), warnings: [] },
    tags: source.tags, themes: source.themes ?? [], variantAssignments: normalizeVariantAssignments(source.variants),
    recognition: source.recognition ?? { version: 1, rules: [], identityMarkers: [], episodeDates: {} }
  };
}

export function emptyLibraryState() {
  return {
    library: { episodes: {}, warnings: [] },
    themes: [],
    tags: { version: 3, categories: [], episodeTags: {} },
    recognition: { version: 1, rules: [], identityMarkers: [], episodeDates: {} },
    variantAssignments: { version: 3, peekRelations: {}, episodes: {} }
  };
}

export function indexImportedFiles(files) {
  const paths = new Map();
  const names = new Map();
  const identities = new Map();
  const add = (map, key, file) => map.set(key, map.has(key) ? null : file);
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).replaceAll('\\', '/').split('/');
    for (let i = 0; i < parts.length; i++) add(paths, parts.slice(i).join('/'), file);
    add(names, file.name, file);
    const identity = datedFileIdentity(file);
    if (identity) {
      file.sourceLayout = matchArchiveFolderName(parts.at(-2))?.layout;
      const previous = identities.get(identity);
      if (!previous || compareDatedSourcePriority(file, previous) < 0) identities.set(identity, file);
    }
  }
  return { paths, names, identities };
}

export function matchImportedFile(reference, files) {
  const index = Array.isArray(files) ? indexImportedFiles(files) : files;
  const relative = String(reference.relativePath ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (relative && index.paths.has(relative)) return index.paths.get(relative);
  return index.names.get(reference.name) ?? index.identities?.get(datedFileIdentity(reference)) ?? null;
}
