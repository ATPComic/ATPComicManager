import { getImageFileAssignments, getImageFileMetadata, parseImageFilename } from './filename.js';
import { getEffectiveVariantSources } from '../model/effective-variants.js';
import {
  compareVariantNames,
  getBaseVariantName,
  isSpecialVariantName
} from '../../public/variant-assignment-model.js';

function pushIssue(target, issue) {
  target.push({
    type: issue.type,
    severity: issue.severity,
    message: issue.message,
    episodeId: issue.episodeId ?? null,
    path: issue.path ?? null,
    relatedPaths: issue.relatedPaths ?? []
  });
}

export function validateEpisode(episodeId, episode) {
  const warnings = [];
  const errors = [];
  const byVariant = new Map();

  for (const file of episode.files) {
    const source = parseImageFilename(file.name);
    const parsed = getImageFileMetadata(file);
    const assignments = getImageFileAssignments(file);
    if (!parsed) {
      pushIssue(errors, {
        type: 'invalid-filename',
        severity: 'error',
        episodeId,
        path: file.relativePath,
        message: `Invalid filename: ${file.name}`
      });
      continue;
    }

    if (!assignments.length) {
      pushIssue(warnings, {
        type: 'unassigned-variant',
        severity: 'warning',
        episodeId,
        path: file.relativePath,
        message: `Manual variant assignment required for ${source?.episodeId ?? episodeId}:${file.assignmentToken ?? parsed.pageNumber}`
      });
      continue;
    }

    if (parsed.episodeId && parsed.episodeId !== episodeId) {
      pushIssue(errors, {
        type: 'folder-file-date-mismatch',
        severity: 'error',
        episodeId,
        path: file.relativePath,
        message: `Folder ${episodeId} contains ${file.name}`
      });
    }

    for (const assignment of assignments) {
      if (!byVariant.has(assignment.variant)) byVariant.set(assignment.variant, []);
      byVariant.get(assignment.variant).push({ ...assignment, file });
    }
  }

  const effectivePages = new Map();
  for (const { assignment } of getEffectiveVariantSources(episode)) {
    if (!effectivePages.has(assignment.variant)) effectivePages.set(assignment.variant, new Set());
    effectivePages.get(assignment.variant).add(assignment.pageNumber);
  }

  for (const variant of byVariant.keys()) {
    if (!isSpecialVariantName(variant) || byVariant.has(getBaseVariantName(variant))) continue;
    pushIssue(warnings, {
      type: 'special-variant-base-missing',
      severity: 'warning',
      episodeId,
      message: `Special variant ${variant} has no base variant ${getBaseVariantName(variant)}`
    });
  }

  for (const [variant, items] of byVariant.entries()) {
    const seenPages = new Map();
    for (const item of items) {
      const list = seenPages.get(item.pageNumber) ?? [];
      list.push(item.file.relativePath);
      seenPages.set(item.pageNumber, list);
    }

    for (const [pageNumber, paths] of seenPages.entries()) {
      if (paths.length > 1) {
        pushIssue(warnings, {
          type: 'duplicate-page-number',
          severity: 'warning',
          episodeId,
          path: paths[0],
          relatedPaths: paths.slice(1),
          message: `Duplicate page number ${variant}${pageNumber}`
        });
      }
    }

    const completePages = effectivePages.get(variant) ?? new Set(seenPages.keys());
    const uniquePages = [...completePages].sort((left, right) => left - right);
    const maxPage = uniquePages.at(-1) ?? 0;
    for (let pageNumber = 1; pageNumber <= maxPage; pageNumber += 1) {
      if (!completePages.has(pageNumber)) {
        pushIssue(warnings, {
          type: 'missing-pages',
          severity: 'warning',
          episodeId,
          message: `Missing page ${variant}${pageNumber}`
        });
      }
    }
  }

  const variantPages = new Map();
  for (const variant of byVariant.keys()) {
    variantPages.set(variant, effectivePages.get(variant) ?? new Set());
  }

  const variantNames = [...variantPages.keys()].sort(compareVariantNames);
  const referenceVariant = variantNames[0];
  const referencePages = variantPages.get(referenceVariant);
  for (const variant of variantNames.slice(1)) {
    const pages = variantPages.get(variant);
    const matchesReference = pages.size === referencePages.size
      && [...referencePages].every((page) => pages.has(page));
    if (!matchesReference) {
      pushIssue(warnings, {
        type: 'variant-mismatch',
        severity: 'warning',
        episodeId,
        message: `Variant ${referenceVariant} has ${referencePages.size} pages while variant ${variant} has ${pages.size} pages`
      });
    }
  }

  return { warnings, errors };
}

export function validateLibrary(library) {
  const warnings = [];
  const errors = [];

  for (const [episodeId, episode] of Object.entries(library.episodes)) {
    const result = validateEpisode(episodeId, episode);
    warnings.push(...result.warnings);
    errors.push(...result.errors);
  }

  return { warnings, errors };
}
