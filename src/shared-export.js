import path from 'node:path';

function isAbsoluteReference(value) {
  return typeof value === 'string' && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^file:/i.test(value));
}

function relativeReference(value) {
  return isAbsoluteReference(value) ? undefined : value;
}

export function portableLibrary(library) {
  return {
    generatedAt: library.generatedAt,
    episodes: Object.fromEntries(Object.entries(library.episodes ?? {}).map(([id, episode]) => [id, {
      layout: episode.layout,
      title: episode.title,
      date: episode.date,
      sourceKey: relativeReference(episode.sourceKey),
      variants: episode.variants,
      peekRelations: episode.peekRelations,
      missing: episode.missing,
      files: (episode.files ?? []).map(file => ({
        name: file.name,
        relativePath: relativeReference(file.relativePath),
        assignmentToken: file.assignmentToken,
        sourcePageNumber: file.sourcePageNumber,
        variantSource: file.variantSource,
        variant: file.variant,
        pageNumber: file.pageNumber,
        assignments: file.assignments,
        missing: file.missing
      }))
    }]))
  };
}

// Fail closed for absolute references in identifiers or user-authored metadata.
// Do not echo the offending value, which can contain private directory names.
export function assertPortableJson(value) {
  if (typeof value === 'string') {
    const reference = value.startsWith('folder:') ? value.slice(7) : value;
    if (isAbsoluteReference(reference)) throw new Error('Sharing data contains an absolute path; remove it before exporting');
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertPortableJson(key);
      assertPortableJson(child);
    }
  }
}
