import { portableLibrary, assertPortableJson } from '../../../src/shared-export.js';
import { normalizeVariantAssignments } from '../../../public/variant-assignment-model.js';

export async function collectDirectoryFiles(directory) {
  const files = [];
  async function walk(handle, prefix) {
    for await (const entry of handle.values()) {
      const path = `${prefix}/${entry.name}`;
      if (entry.kind === 'directory') await walk(entry, path);
      else files.push({ name: entry.name, webkitRelativePath: path, handle: entry });
    }
  }
  await walk(directory, directory.name);
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

export function indexImportedFiles(files) {
  const paths = new Map();
  const names = new Map();
  const add = (map, key, file) => map.set(key, map.has(key) ? null : file);
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).replaceAll('\\', '/').split('/');
    for (let i = 0; i < parts.length; i++) add(paths, parts.slice(i).join('/'), file);
    add(names, file.name, file);
  }
  return { paths, names };
}

export function matchImportedFile(reference, files) {
  const index = Array.isArray(files) ? indexImportedFiles(files) : files;
  const relative = String(reference.relativePath ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (relative && index.paths.has(relative)) return index.paths.get(relative);
  return index.names.get(reference.name) ?? null;
}
