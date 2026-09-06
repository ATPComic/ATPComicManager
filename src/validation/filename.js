import { compareVariantNames, normalizeVariantName } from '../../public/variant-assignment-model.js';

const IMAGE_EXTENSION_SOURCE = '(?:jpe?g|png|webp|gif|bmp|tiff?|avif)';
const SOURCE_IMAGE_PATTERN = new RegExp(`^(\\d{8})(.*)\\.${IMAGE_EXTENSION_SOURCE}$`, 'i');
const IMAGE_EXTENSION_PATTERN = new RegExp(`\\.${IMAGE_EXTENSION_SOURCE}$`, 'i');
const SOURCE_TAIL_PATTERN = /(?:^|[_\s-])([a-z]?\d+(?:_[a-z0-9]+)*)$/i;
const DEFAULT_VARIANT_TOKEN_PATTERN = /^([a-z])(\d+)(?:_x)?$/i;
const SOURCE_PAGE_PATTERN = /^[a-z]?(\d+)/i;
function getIdentityMarkers(sourceStem, configuredMarkers) {
  const stem = `_${sourceStem.toLowerCase()}_`;
  return [...new Set(configuredMarkers.map(marker => String(marker).trim().toLowerCase()))]
    .filter(marker => /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(marker) && stem.includes(`_${marker}_`))
    .sort();
}

export function parseImageFilename(fileName, identityMarkers = []) {
  const sourceMatch = String(fileName ?? '').match(SOURCE_IMAGE_PATTERN);
  if (!sourceMatch) return null;
  const [, episodeId, sourceStem] = sourceMatch;
  const sourceToken = sourceStem.match(SOURCE_TAIL_PATTERN)?.[1]?.toLowerCase() ?? null;
  if (!sourceToken) return null;
  const pageNumber = Number(sourceToken.match(SOURCE_PAGE_PATTERN)?.[1]);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
  const markers = getIdentityMarkers(sourceStem, identityMarkers);
  const assignmentToken = [sourceToken, ...markers.filter(marker => !`_${sourceToken}_`.includes(`_${marker}_`))].join('_');
  const defaultMatch = markers.length ? null : sourceToken.match(DEFAULT_VARIANT_TOKEN_PATTERN);
  const variant = defaultMatch?.[1]?.toLowerCase() ?? null;
  return {
    episodeId,
    variant,
    pageNumber,
    fileName,
    assignmentToken,
    hasVariantSuffix: /_x$/i.test(sourceToken),
    requiresVariantAssignment: !variant
  };
}

export function parseUndatedImageFilename(fileName, identityMarkers = []) {
  const match = String(fileName ?? '').match(new RegExp(`^(.+?)\\.${IMAGE_EXTENSION_SOURCE}$`, 'i'));
  if (!match) return null;
  const token = match[1].match(/(?:^|[_\s-])([a-z]?\d+(?:_[a-z0-9]+)*)$/i)?.[1]?.toLowerCase()
    ?? match[1].match(/^(\d+)$/)?.[1];
  if (!token) return null;
  const pageNumber = Number(token.match(/^[a-z]?(\d+)/i)?.[1]);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
  return {
    episodeId: null,
    variant: null,
    pageNumber,
    fileName,
    assignmentToken: [token, ...getIdentityMarkers(match[1], identityMarkers).filter(marker => !`_${token}_`.includes(`_${marker}_`))].join('_'),
    hasVariantSuffix: false,
    requiresVariantAssignment: true
  };
}

export function getVariantAssignmentToken(parsed) {
  return parsed?.assignmentToken ?? null;
}

export function getImageFileMetadata(file) {
  const parsed = parseImageFilename(file?.name ?? '') ?? (file?.assignmentToken ? {
    episodeId: null,
    variant: null,
    pageNumber: Number(file.sourcePageNumber) || 1,
    fileName: file.name,
    assignmentToken: file.assignmentToken,
    hasVariantSuffix: false,
    requiresVariantAssignment: true
  } : null);
  if (!parsed) return null;
  const assignment = getImageFileAssignments(file)[0];
  const pageNumber = Number(assignment?.pageNumber ?? file?.pageNumber ?? parsed.pageNumber);
  return {
    ...parsed,
    variant: assignment?.variant ?? file?.variant ?? parsed.variant,
    pageNumber: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : parsed.pageNumber
  };
}

export function getImageFileAssignments(file) {
  const parsed = parseImageFilename(file?.name ?? '') ?? (file?.assignmentToken ? {
    episodeId: null,
    variant: null,
    pageNumber: Number(file.sourcePageNumber) || 1,
    fileName: file.name,
    assignmentToken: file.assignmentToken,
    hasVariantSuffix: false,
    requiresVariantAssignment: true
  } : null);
  if (!parsed) return [];
  if (Array.isArray(file?.assignments)) {
    const seen = new Set();
    return file.assignments.flatMap((assignment) => {
      const variant = normalizeVariantName(assignment?.variant);
      const pageNumber = Number(assignment?.pageNumber);
      const key = `${variant}:${pageNumber}`;
      if (!variant || !Number.isInteger(pageNumber) || pageNumber < 1 || seen.has(key)) return [];
      seen.add(key);
      return [{ ...parsed, variant, pageNumber }];
    });
  }
  const variant = file?.variant ?? parsed.variant;
  const pageNumber = Number(file?.pageNumber ?? parsed.pageNumber);
  const normalizedVariant = normalizeVariantName(variant);
  return normalizedVariant && Number.isInteger(pageNumber) && pageNumber > 0
    ? [{ ...parsed, variant: normalizedVariant, pageNumber }]
    : [];
}

// Convert <date>_<variant><page>[..._x].jpg to <date>_<page><variant>[..._x].jpg
// so Reading-folder files sort by page number first, keeping variants adjacent
// for better NeeView prefetch while switching variants.
export function toReadingFileName(fileName, assignment = null) {
  const parsed = parseImageFilename(fileName);
  if (!parsed) {
    const variant = normalizeVariantName(assignment?.variant);
    const pageNumber = Number(assignment?.pageNumber);
    const extension = String(fileName ?? '').match(IMAGE_EXTENSION_PATTERN)?.[0] ?? '.jpg';
    return variant && Number.isInteger(pageNumber) && pageNumber > 0
      ? `${pageNumber}${variant}${extension}`
      : fileName;
  }
  const variant = assignment?.variant ?? parsed.variant;
  const pageNumber = Number(assignment?.pageNumber ?? parsed.pageNumber);
  if (!variant || !Number.isInteger(pageNumber) || pageNumber < 1) return fileName;
  const extMatch = fileName.match(IMAGE_EXTENSION_PATTERN);
  const ext = extMatch ? extMatch[0] : '.jpg';
  return `${parsed.episodeId}_${pageNumber}${variant}${parsed.hasVariantSuffix ? '_x' : ''}${ext}`;
}

export function compareImageFilenames(leftName, rightName) {
  const left = parseImageFilename(leftName);
  const right = parseImageFilename(rightName);

  if (!left && !right) {
    return leftName.localeCompare(rightName);
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }

  const episodeComparison = left.episodeId.localeCompare(right.episodeId);
  if (episodeComparison !== 0) {
    return episodeComparison;
  }

  const variantComparison = left.variant && right.variant
    ? compareVariantNames(left.variant, right.variant)
    : left.variant ? -1 : right.variant ? 1 : 0;
  if (variantComparison !== 0) {
    return variantComparison;
  }

  const pageComparison = left.pageNumber - right.pageNumber;
  if (pageComparison !== 0) {
    return pageComparison;
  }

  const suffixComparison = Number(left.hasVariantSuffix) - Number(right.hasVariantSuffix);
  if (suffixComparison !== 0) {
    return suffixComparison;
  }

  return leftName.localeCompare(rightName);
}

export function sortImageFileRecords(files) {
  // API image/thumbnail URLs use the file index. Keep this order derived only
  // from immutable source names so editing variant assignments cannot make an
  // existing URL suddenly refer to another image.
  return [...files].sort((left, right) => {
    const leftPage = Number(left?.sourcePageNumber);
    const rightPage = Number(right?.sourcePageNumber);
    if (Number.isInteger(leftPage) && Number.isInteger(rightPage) && leftPage !== rightPage) return leftPage - rightPage;
    return compareImageFilenames(left.name, right.name);
  });
}

export function isImageFile(fileName) {
  return IMAGE_EXTENSION_PATTERN.test(fileName);
}
