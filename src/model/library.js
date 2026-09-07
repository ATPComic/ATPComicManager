import { storageFor } from '../storage/database.js';
import { isValidEpisodeId } from '../../public/variant-assignment-model.js';
import { datedFileIdentity } from '../validation/filename.js';

export function createEmptyLibrary() {
  return {
    generatedAt: new Date().toISOString(),
    episodes: {},
    warnings: []
  };
}

export function createEpisodeRecord({ episodeId, source, layout }) {
  return {
    source,
    layout,
    variants: {
      a: [],
      b: [],
      c: []
    },
    peekRelations: {},
    files: [],
    warnings: [],
    errors: []
  };
}

export function ensureEpisode(library, episodeId, data) {
  if (!library.episodes[episodeId]) {
    library.episodes[episodeId] = createEpisodeRecord({
      episodeId,
      source: data.source,
      layout: data.layout
    });
  }
  const episode = library.episodes[episodeId];
  if (data.source && !episode.source) {
    episode.source = data.source;
  }
  if (data.layout && !episode.layout) {
    episode.layout = data.layout;
  }
  return episode;
}

export function addLibraryWarning(library, warning) {
  library.warnings.push(warning);
}

export function cloneEpisodeRecord(episode) {
  const variants = {};
  for (const [variantName, pages] of Object.entries(episode.variants ?? {})) {
    variants[variantName] = [...(pages ?? [])];
  }
  return {
    ...(episode.title ? { title: episode.title } : {}),
    ...(episode.date ? { date: episode.date } : {}),
    ...(episode.sourceKey ? { sourceKey: episode.sourceKey } : {}),
    ...(episode.missing ? { missing: true } : {}),
    source: episode.source,
    layout: episode.layout,
    variants,
    peekRelations: { ...(episode.peekRelations ?? {}) },
    files: [...(episode.files ?? [])],
    warnings: [...(episode.warnings ?? [])],
    errors: [...(episode.errors ?? [])]
  };
}

function importedFile(file) {
  const portable = { ...(file ?? {}) };
  delete portable.absolutePath;
  delete portable.source;
  return { ...portable, missing: true, absolutePath: null, source: null };
}

export function mergeSharedLibrary(library, sharedLibrary, identityMarkers = []) {
  for (const [episodeId, sharedEpisode] of Object.entries(sharedLibrary?.episodes ?? {})) {
    if (!isValidEpisodeId(episodeId) || !sharedEpisode || typeof sharedEpisode !== 'object') continue;
    const sharedFiles = Array.isArray(sharedEpisode.files) ? sharedEpisode.files : [];
    const safeSharedEpisode = {
      ...sharedEpisode,
      variants: sharedEpisode.variants && typeof sharedEpisode.variants === 'object' ? sharedEpisode.variants : {},
      peekRelations: sharedEpisode.peekRelations && typeof sharedEpisode.peekRelations === 'object' ? sharedEpisode.peekRelations : {},
      warnings: Array.isArray(sharedEpisode.warnings) ? sharedEpisode.warnings : [],
      errors: Array.isArray(sharedEpisode.errors) ? sharedEpisode.errors : []
    };
    let episode = library.episodes[episodeId];
    if (!episode) {
      episode = cloneEpisodeRecord({ ...safeSharedEpisode, missing: true, files: [] });
      library.episodes[episodeId] = episode;
      library.warnings.push({
        type: 'missing-imported-episode', severity: 'warning', episodeId, path: null,
        message: `Imported episode is missing locally: ${sharedEpisode.title ?? episodeId}`
      });
    }
    const localNames = new Set((episode.files ?? []).map((file) => file.name));
    const localIdentities = new Set(/^\d{8}$/.test(episodeId) ? (episode.files ?? []).map(file => datedFileIdentity(file, identityMarkers)).filter(Boolean) : []);
    for (const file of sharedFiles) {
      if (localNames.has(file?.name) || localIdentities.has(datedFileIdentity(file, identityMarkers))) continue;
      episode.files.push(importedFile(file));
      library.warnings.push({
        type: 'missing-imported-image', severity: 'warning', episodeId, path: file?.relativePath ?? file?.name ?? null,
        message: `Imported image is missing locally: ${file?.name ?? 'unknown'}`
      });
    }
    if (!episode.title && sharedEpisode.title) episode.title = sharedEpisode.title;
    if (!episode.date && sharedEpisode.date) episode.date = sharedEpisode.date;
    episode.files.sort((left, right) => {
      const pageDifference = Number(left?.sourcePageNumber ?? left?.pageNumber) - Number(right?.sourcePageNumber ?? right?.pageNumber);
      return Number.isFinite(pageDifference) && pageDifference ? pageDifference : String(left?.name ?? '').localeCompare(String(right?.name ?? ''), undefined, { numeric: true });
    });
  }
  return library;
}

export function mergeLibraryInto(target, source, originLabel) {
  for (const warning of source.warnings ?? []) {
    target.warnings.push({
      ...warning,
      sourceRoot: originLabel ?? warning.sourceRoot ?? null
    });
  }

  for (const [episodeId, episode] of Object.entries(source.episodes ?? {})) {
    const existing = target.episodes[episodeId];
    if (!existing) {
      target.episodes[episodeId] = cloneEpisodeRecord(episode);
      continue;
    }

    if (existing.source && episode.source && existing.source !== episode.source) {
      target.warnings.push({
        type: 'duplicate-episode-source',
        severity: 'warning',
        episodeId,
        path: existing.source,
        relatedPaths: [episode.source],
        message: `Episode ${episodeId} appears in multiple scan roots`
      });
    }

    existing.files.push(...(episode.files ?? []));
    if (!existing.title && episode.title) existing.title = episode.title;
    if (!existing.date && episode.date) existing.date = episode.date;
    if (!existing.sourceKey && episode.sourceKey) existing.sourceKey = episode.sourceKey;
    for (const [variantName, pages] of Object.entries(episode.variants ?? {})) {
      if (!existing.variants[variantName]) {
        existing.variants[variantName] = [];
      }
      existing.variants[variantName].push(...(pages ?? []));
    }
    existing.peekRelations = {
      ...(existing.peekRelations ?? {}),
      ...(episode.peekRelations ?? {})
    };
    existing.warnings.push(...(episode.warnings ?? []));
    existing.errors.push(...(episode.errors ?? []));
  }
}

export async function writeLibrary(databasePath, library) {
  return storageFor(databasePath).write('library', library);
}

export async function readLibrary(databasePath) {
  return storageFor(databasePath).read('library');
}
