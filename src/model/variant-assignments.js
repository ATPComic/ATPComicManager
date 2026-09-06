import {
  DEFAULT_VARIANT_NAMES,
  compareVariantNames,
  findVariantAssignments,
  getEpisodeVariantNames,
  isSpecialVariantName,
  normalizePeekRelations,
  normalizeVariantAssignments
} from '../../public/variant-assignment-model.js';
import { getVariantAssignmentToken, parseImageFilename } from '../validation/filename.js';
import { getEffectiveVariantSources } from './effective-variants.js';

export function applyVariantAssignments(library, input, identityMarkers = []) {
  const state = normalizeVariantAssignments(input);

  for (const [episodeId, episode] of Object.entries(library.episodes ?? {})) {
    const assignments = state.episodes[episodeId] ?? Object.fromEntries(DEFAULT_VARIANT_NAMES.map((variant) => [variant, []]));
    const pageMappings = state.pageMappings?.[episodeId] ?? {};
    const hasAuthoritativeAssignments = state.version >= 3 && Object.hasOwn(state.episodes, episodeId);
    const variantNames = new Set(getEpisodeVariantNames(assignments));
    const tokenCounts = new Map();

    for (const file of episode.files ?? []) {
      const parsed = parseImageFilename(file.name, identityMarkers) ?? (file.assignmentToken ? {
        pageNumber: Number(file.sourcePageNumber) || 1,
        assignmentToken: file.assignmentToken,
        variant: null
      } : null);
      if (!parsed) continue;
      file.sourcePageNumber = parsed.pageNumber;
      file.assignmentToken = getVariantAssignmentToken(parsed);
      const manual = file.assignmentToken ? findVariantAssignments(assignments, file.assignmentToken) : [];
      file.assignments = manual.length
        ? manual.map(({ variant, index }) => {
          const mappedPageNumber = Number(pageMappings[variant]?.[file.assignmentToken]);
          return {
            variant,
            pageNumber: Number.isInteger(mappedPageNumber) && mappedPageNumber > 0
              ? mappedPageNumber
              : isSpecialVariantName(variant) ? parsed.pageNumber : index + 1
          };
        })
        : !hasAuthoritativeAssignments && parsed.variant
          ? [{ variant: parsed.variant, pageNumber: parsed.pageNumber }]
          : [];
      file.variant = file.assignments[0]?.variant ?? null;
      file.pageNumber = file.assignments[0]?.pageNumber ?? parsed.pageNumber;
      file.variantSource = manual.length ? 'manual' : file.assignments.length ? 'filename' : 'unassigned';
      for (const assignment of file.assignments) variantNames.add(assignment.variant);
      if (file.assignmentToken) {
        tokenCounts.set(file.assignmentToken, (tokenCounts.get(file.assignmentToken) ?? 0) + 1);
      }
    }

    episode.variants = Object.fromEntries([...variantNames].sort(compareVariantNames).map((variant) => [variant, []]));
    for (const { assignment } of getEffectiveVariantSources(episode)) {
      if (!episode.variants[assignment.variant]) episode.variants[assignment.variant] = [];
      episode.variants[assignment.variant].push(assignment.pageNumber);
    }
    for (const pages of Object.values(episode.variants)) {
      const unique = [...new Set(pages)].sort((left, right) => left - right);
      pages.splice(0, pages.length, ...unique);
    }
    const knownVariants = new Set(Object.entries(episode.variants)
      .filter(([, pages]) => pages.length)
      .map(([variant]) => variant));
    episode.peekRelations = Object.fromEntries(Object.entries(normalizePeekRelations(state.peekRelations[episodeId]))
      .filter(([source, target]) => knownVariants.has(source) && (target === null || knownVariants.has(target))));

    for (const [token, count] of tokenCounts.entries()) {
      if (count < 2) continue;
      library.warnings.push({
        type: 'ambiguous-variant-token',
        severity: 'warning',
        episodeId,
        path: null,
        relatedPaths: [],
        message: `Multiple files share manual variant token ${episodeId}:${token}`
      });
    }
  }

  return library;
}
