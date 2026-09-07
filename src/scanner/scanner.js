import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createEmptyLibrary, ensureEpisode, addLibraryWarning, mergeLibraryInto } from '../model/library.js';
import { applyVariantAssignments } from '../model/variant-assignments.js';
import { isImageFile, parseImageFilename, parseUndatedImageFilename, sortImageFileRecords } from '../validation/filename.js';
import { validateLibrary } from '../validation/validator.js';
import { getFolderBaseName, relativePosixPath, toPosixPath } from '../utils/path.js';
import { discoverArchiveRoots } from './discovery.js';
import { matchesRecognitionRule } from '../recognition-store.js';

const FOLDER_PATTERN = /^\d{8}$/;
const MONTH_PATTERN = /^\d{6}$/;

async function readDirectoryEntries(rootPath) {
  return fs.readdir(rootPath, { withFileTypes: true });
}

async function collectFiles(rootPath) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files;
}

function registerFile(library, episodeId, fileRecord, layout, sourcePath, parsedInput = null) {
  const episode = ensureEpisode(library, episodeId, {
    source: sourcePath,
    layout
  });
  episode.files.push({ ...fileRecord, sourceLayout: layout });
  const parsed = parsedInput ?? parseImageFilename(fileRecord.name);
  if (parsed?.variant) {
    if (!episode.variants[parsed.variant]) episode.variants[parsed.variant] = [];
    episode.variants[parsed.variant].push(parsed.pageNumber);
  }
}

async function scanUndatedFolder(library, archiveRoot, workspaceRoot, folderEntry, recognition) {
  const folderPath = path.join(archiveRoot, folderEntry.name);
  const sourceKey = toPosixPath(path.relative(workspaceRoot, folderPath));
  const episodeId = `folder:${sourceKey}`;
  const episode = ensureEpisode(library, episodeId, { source: folderPath, layout: 'rule-folder' });
  episode.title = folderEntry.name;
  episode.sourceKey = sourceKey;
  episode.date = recognition?.episodeDates?.[episodeId] ?? null;
  const files = await collectFiles(folderPath);
  for (const fileName of files) {
    const relativePath = relativePosixPath(archiveRoot, path.join(folderPath, fileName));
    const parsed = isImageFile(fileName) ? parseUndatedImageFilename(fileName, recognition?.identityMarkers) : null;
    if (!parsed) {
      addLibraryWarning(library, {
        type: 'invalid-filename', severity: 'warning', episodeId, path: relativePath,
        message: `Invalid undated-folder image filename: ${fileName}`
      });
      continue;
    }
    registerFile(library, episodeId, {
      name: fileName,
      relativePath,
      absolutePath: path.join(folderPath, fileName),
      source: folderPath,
      sourcePageNumber: parsed.pageNumber,
      assignmentToken: parsed.assignmentToken
    }, 'rule-folder', folderPath, parsed);
  }
  if (!episode.date) {
    addLibraryWarning(library, {
      type: 'undated-episode', severity: 'warning', episodeId, path: sourceKey,
      message: `No date assigned to ${folderEntry.name}`
    });
  }
}

async function scanEpisodeFolder(library, archiveRoot, folderEntry, identityMarkers) {
  const folderPath = path.join(archiveRoot, folderEntry.name);
  const baseEpisodeId = getFolderBaseName(folderEntry.name);
  const files = await collectFiles(folderPath);

  const fileByKey = new Map();
  for (const fileName of files) {
    if (!isImageFile(fileName)) {
      addLibraryWarning(library, {
        type: 'invalid-filename',
        severity: 'warning',
        episodeId: baseEpisodeId,
        path: relativePosixPath(archiveRoot, path.join(folderPath, fileName)),
        message: `Invalid filename: ${fileName}`
      });
      continue;
    }

    const parsed = parseImageFilename(fileName, identityMarkers);
    const relativePath = relativePosixPath(archiveRoot, path.join(folderPath, fileName));
    if (!parsed) {
      addLibraryWarning(library, {
        type: 'invalid-filename',
        severity: 'warning',
        episodeId: baseEpisodeId,
        path: relativePath,
        message: `Invalid filename: ${fileName}`
      });
      continue;
    }

    if (parsed.episodeId !== baseEpisodeId) {
      addLibraryWarning(library, {
        type: 'folder-file-date-mismatch',
        severity: 'error',
        episodeId: baseEpisodeId,
        path: relativePath,
        message: `Folder ${baseEpisodeId} contains ${fileName}`
      });
    }

    if (parsed.variant) {
      const key = `${parsed.episodeId}:${parsed.variant}:${parsed.pageNumber}`;
      const existing = fileByKey.get(key) ?? [];
      existing.push(relativePath);
      fileByKey.set(key, existing);
    }

    registerFile(library, baseEpisodeId, {
      name: fileName,
      relativePath,
      absolutePath: path.join(folderPath, fileName),
      source: folderPath
    }, 'folder', folderPath, parsed);
  }

  for (const [key, paths] of fileByKey.entries()) {
    if (paths.length > 1) {
      const [episodeId, variant, pageNumber] = key.split(':');
      addLibraryWarning(library, {
        type: 'duplicate-page-number',
        severity: 'warning',
        episodeId,
        path: paths[0],
        relatedPaths: paths.slice(1),
        message: `Duplicate page number ${variant}${pageNumber}`
      });
    }
  }
}

async function scanMonthFolder(library, archiveRoot, folderEntry, identityMarkers) {
  const folderPath = path.join(archiveRoot, folderEntry.name);
  const files = await collectFiles(folderPath);
  const fileByKey = new Map();

  for (const fileName of files) {
    if (!isImageFile(fileName)) {
      addLibraryWarning(library, {
        type: 'invalid-filename',
        severity: 'warning',
        episodeId: folderEntry.name,
        path: relativePosixPath(archiveRoot, path.join(folderPath, fileName)),
        message: `Invalid filename: ${fileName}`
      });
      continue;
    }

    const parsed = parseImageFilename(fileName, identityMarkers);
    const relativePath = relativePosixPath(archiveRoot, path.join(folderPath, fileName));
    if (!parsed) {
      addLibraryWarning(library, {
        type: 'invalid-filename',
        severity: 'warning',
        episodeId: folderEntry.name,
        path: relativePath,
        message: `Invalid filename: ${fileName}`
      });
      continue;
    }

    if (!parsed.episodeId.startsWith(folderEntry.name)) {
      addLibraryWarning(library, {
        type: 'folder-file-date-mismatch',
        severity: 'error',
        episodeId: parsed.episodeId,
        path: relativePath,
        message: `Folder ${folderEntry.name} contains ${fileName}`
      });
    }

    if (parsed.variant) {
      const key = `${parsed.episodeId}:${parsed.variant}:${parsed.pageNumber}`;
      const existing = fileByKey.get(key) ?? [];
      existing.push(relativePath);
      fileByKey.set(key, existing);
    }

    registerFile(library, parsed.episodeId, {
      name: fileName,
      relativePath,
      absolutePath: path.join(folderPath, fileName),
      source: folderPath
    }, 'month-flat', folderPath, parsed);
  }

  for (const [key, paths] of fileByKey.entries()) {
    if (paths.length > 1) {
      const [episodeId, variant, pageNumber] = key.split(':');
      addLibraryWarning(library, {
        type: 'duplicate-page-number',
        severity: 'warning',
        episodeId,
        path: paths[0],
        relatedPaths: paths.slice(1),
        message: `Duplicate page number ${variant}${pageNumber}`
      });
    }
  }
}

export async function scanArchive(archiveRoot, workspaceRoot, variantAssignments = null, { finalize = true, recognition = null } = {}) {
  const library = createEmptyLibrary();
  const entries = await readDirectoryEntries(archiveRoot);
  const directories = entries.filter((entry) => entry.isDirectory());

  for (const entry of directories) {
    if (FOLDER_PATTERN.test(entry.name)) {
      await scanEpisodeFolder(library, archiveRoot, entry, recognition?.identityMarkers);
      continue;
    }
    if (MONTH_PATTERN.test(entry.name)) {
      await scanMonthFolder(library, archiveRoot, entry, recognition?.identityMarkers);
      continue;
    }
    if (matchesRecognitionRule(entry.name, recognition?.rules)) {
      await scanUndatedFolder(library, archiveRoot, workspaceRoot, entry, recognition);
    }
  }

  if (finalize) {
    applyVariantAssignments(library, variantAssignments, recognition?.identityMarkers);
    const validation = validateLibrary(library);
    for (const warning of validation.warnings) {
      addLibraryWarning(library, warning);
    }
    for (const error of validation.errors) {
      addLibraryWarning(library, error);
    }

    for (const episode of Object.values(library.episodes)) {
      episode.files = sortImageFileRecords(episode.files);
    }
  }

  library.meta = {
    archiveRoot: toPosixPath(path.relative(workspaceRoot, archiveRoot) || '.')
  };

  return library;
}

export async function scanWorkspace(workspaceRoot, explicitArchiveRoot, variantAssignments = null, recognition = null) {
  const roots = await discoverArchiveRoots(workspaceRoot, explicitArchiveRoot, recognition?.rules);
  const library = createEmptyLibrary();

  for (const root of roots) {
    const scanned = await scanArchive(root, workspaceRoot, variantAssignments, { finalize: false, recognition });
    mergeLibraryInto(library, scanned, root);
  }

  applyVariantAssignments(library, variantAssignments, recognition?.identityMarkers);
  const validation = validateLibrary(library);
  for (const warning of validation.warnings) addLibraryWarning(library, warning);
  for (const error of validation.errors) addLibraryWarning(library, error);
  for (const episode of Object.values(library.episodes)) {
    episode.files = sortImageFileRecords(episode.files);
  }

  library.generatedAt = new Date().toISOString();
  library.meta = {
    archiveRoots: roots.map((root) => toPosixPath(path.relative(workspaceRoot, root) || '.'))
  };

  return library;
}
