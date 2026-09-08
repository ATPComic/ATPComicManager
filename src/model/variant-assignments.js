import {
  DEFAULT_VARIANT_NAMES,
  compareVariantNames,
  findVariantAssignments,
  getEpisodeVariantNames,
  isSpecialVariantName,
  normalizePeekRelations,
  normalizeVariantAssignments
} from '../../public/variant-assignment-model.js';
import { getVariantAssignmentToken, parseImageFilename, parseUndatedImageFilename, selectDatedSources, getAutomaticVariantCandidate, compareDatedSourcePriority } from '../validation/filename.js';
import { getEffectiveVariantSources } from './effective-variants.js';

export function applyVariantAssignments(library, input, identityMarkers = []) {
  const state = normalizeVariantAssignments(input);
  selectDatedSources(library, identityMarkers);

  for (const [episodeId, episode] of Object.entries(library.episodes ?? {})) {
    const assignments = state.episodes[episodeId] ?? Object.fromEntries(DEFAULT_VARIANT_NAMES.map((variant) => [variant, []]));
    const pageMappings = state.pageMappings?.[episodeId] ?? {};
    const hasAuthoritativeAssignments = state.version >= 3 && Object.hasOwn(state.episodes, episodeId);
    const variantNames = new Set(getEpisodeVariantNames(assignments));
    const tokenCounts = new Map();
    const parsedFiles = new Map((episode.files ?? []).map(file => [file, /^\d{8}$/.test(episodeId) ? parseImageFilename(file.name, identityMarkers) : parseUndatedImageFilename(file.name, identityMarkers)]));
    const automatic = new Map();
    if (!hasAuthoritativeAssignments) {
      for (const [file, parsed] of parsedFiles) {
        const candidate = getAutomaticVariantCandidate(file.name, parsed, identityMarkers);
        if (!candidate) continue;
        const key = `${candidate.variant}:${candidate.pageNumber}`;
        const existing = automatic.get(key);
        const priority = existing ? Number(existing.file.sourceLayout === 'month-flat') - Number(file.sourceLayout === 'month-flat')
          || candidate.suffixLength - existing.candidate.suffixLength
          || compareDatedSourcePriority(file, existing.file) : -1;
        if (priority < 0) automatic.set(key, { file, candidate });
      }
    }
    const selectedAutomatic = new Map([...automatic.values()].map(({file, candidate}) => [file, candidate]));

    for (const file of episode.files ?? []) {
      const parsed = parsedFiles.get(file);
      if (!parsed) continue;
      file.sourcePageNumber = parsed.pageNumber;
      file.assignmentToken = getVariantAssignmentToken(parsed);
      const manual = file.assignmentToken ? findVariantAssignments(assignments, file.assignmentToken) : [];
      const automaticCandidate = selectedAutomatic.get(file);
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
        : automaticCandidate
          ? [{ variant: automaticCandidate.variant, pageNumber: automaticCandidate.pageNumber }]
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
