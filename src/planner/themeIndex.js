import { promises as fs } from 'node:fs';
import path from 'node:path';
import { toReadingFileName } from '../validation/filename.js';
import { getEffectiveVariantSources } from '../model/effective-variants.js';
import { compareVariantNames } from '../../public/variant-assignment-model.js';
import { toPosixPath } from '../utils/path.js';

function getVariantNames(episode) {
  return Object.keys(episode.variants ?? {}).sort(compareVariantNames);
}

function buildEpisodeIndex(episodeId, episode, episodeFolderName) {
  const variants = {};

  for (const variantName of getVariantNames(episode)) {
    variants[variantName] = [];
  }

  for (const { file, assignment } of getEffectiveVariantSources(episode)) {
    if (!variants[assignment.variant]) variants[assignment.variant] = [];
    variants[assignment.variant].push({
      page: assignment.pageNumber,
      file: toPosixPath(`${episodeFolderName}/${toReadingFileName(file.name, assignment)}`)
    });
  }

  // Export only variants with pages, omitting empty initialized columns.
  for (const variantName of Object.keys(variants)) {
    variants[variantName].sort((left, right) => left.page - right.page || left.file.localeCompare(right.file));
    if (variants[variantName].length === 0) {
      delete variants[variantName];
    }
  }

  return {
    episode: episodeFolderName,
    date: episodeId,
    title: episode.title ?? episodeId,
    readingDate: episode.date ?? (/^\d{8}$/.test(episodeId) ? episodeId : null),
    variants,
    ...(Object.keys(episode.peekRelations ?? {}).length ? { peekRelations: episode.peekRelations } : {})
  };
}

export function buildThemeIndex(theme, library) {
  const episodes = [];

  for (const [episodeIndex, episodeId] of (theme.episodes ?? []).entries()) {
    const episode = library.episodes[episodeId];
    if (!episode) {
      continue;
    }
    const episodeFolderName = String(episodeIndex + 1).padStart(3, '0');
    episodes.push(buildEpisodeIndex(episodeId, episode, episodeFolderName));
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    theme: theme.title,
    episodes
  };
}

export function getThemeIndexPath(themeFolderPath) {
  return path.join(themeFolderPath, '.theme-index.json');
}

export async function writeThemeIndexFile(themeFolderPath, themeIndex) {
  const filePath = getThemeIndexPath(themeFolderPath);
  await fs.writeFile(filePath, `${JSON.stringify(themeIndex, null, 2)}\n`, 'utf8');
}
