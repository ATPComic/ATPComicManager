import path from 'node:path';
import { resolvePathInside, toPosixPath } from '../utils/path.js';
import { toReadingFileName } from '../validation/filename.js';
import { getEffectiveVariantSources } from '../model/effective-variants.js';
import { compareVariantNames } from '../../public/variant-assignment-model.js';
import { buildThemeIndex } from './themeIndex.js';

function createThemePlan(theme, library, readingRoot) {
  const steps = [];
  const resolvedReadingRoot = path.resolve(readingRoot);
  const themeFolder = resolvePathInside(resolvedReadingRoot, path.join(resolvedReadingRoot, String(theme.title ?? '')));
  const episodes = [...(theme.episodes ?? [])];

  steps.push({ type: 'create-folder', path: toPosixPath(themeFolder) });

  episodes.forEach((episodeId, index) => {
    const episode = library.episodes[episodeId];
    if (!episode) {
      return;
    }
    const episodeFolder = resolvePathInside(
      resolvedReadingRoot,
      path.join(themeFolder, String(index + 1).padStart(3, '0'))
    );
    steps.push({ type: 'create-folder', path: toPosixPath(episodeFolder) });

    const linkSteps = [];
    for (const { file, assignment } of getEffectiveVariantSources(episode)) {
      linkSteps.push({
        type: 'create-hard-link',
        source: file.absolutePath,
        target: toPosixPath(resolvePathInside(
          resolvedReadingRoot,
          path.join(episodeFolder, toReadingFileName(file.name, assignment))
        )),
        variant: assignment.variant,
        pageNumber: assignment.pageNumber
      });
    }
    linkSteps.sort((left, right) => (
      compareVariantNames(left.variant, right.variant)
      || left.pageNumber - right.pageNumber
      || left.target.localeCompare(right.target)
    ));
    steps.push(...linkSteps.map(({ variant: _variant, pageNumber: _pageNumber, ...step }) => step));
  });

  steps.push({
    type: 'write-theme-index',
    path: toPosixPath(resolvePathInside(resolvedReadingRoot, path.join(themeFolder, '.theme-index.json'))),
    themeIndex: buildThemeIndex(theme, library)
  });

  return steps;
}

export function createPlan(library, themes, config) {
  const steps = [];
  const warnings = [...library.warnings];

  for (const theme of themes) {
    steps.push(...createThemePlan(theme, library, config.readingRoot));
  }

  return {
    generatedAt: new Date().toISOString(),
    readingRoot: toPosixPath(config.readingRoot),
    steps,
    warnings
  };
}
