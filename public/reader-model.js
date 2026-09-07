import {
  compareVariantNames,
  getBaseVariantName,
  isSpecialVariantName,
  normalizeVariantName
} from './variant-assignment-model.js';

const SOURCE_IMAGE_PATTERN = /^(\d{8})_([a-z])(\d+)\.(?:jpe?g|png|webp|gif|bmp|tiff?|avif)$/i;
export const DEFAULT_PEEK_SETTINGS = Object.freeze({ radius: 112, feather: 14, animationSpeed: 100 });
let assetUrlResolver = null;

export function setReaderAssetUrlResolver(resolver = null) {
  assetUrlResolver = typeof resolver === 'function' ? resolver : null;
}

export function normalizePeekSettings(settings = {}) {
  const radiusValue = Number(settings.radius);
  const radius = Number.isFinite(radiusValue)
    ? Math.min(600, Math.max(24, Math.round(radiusValue)))
    : DEFAULT_PEEK_SETTINGS.radius;
  const featherValue = Number(settings.feather);
  const feather = Number.isFinite(featherValue)
    ? Math.min(radius, Math.max(0, Math.round(featherValue)))
    : DEFAULT_PEEK_SETTINGS.feather;
  const speedValue = Number(settings.animationSpeed);
  const animationSpeed = Number.isFinite(speedValue)
    ? Math.min(300, Math.max(25, Math.round(speedValue)))
    : DEFAULT_PEEK_SETTINGS.animationSpeed;
  return { radius, feather, animationSpeed };
}

export function parseReaderFile(file, index) {
  return parseReaderFileAssignments(file, index)[0] ?? null;
}

export function parseReaderFileAssignments(file, index) {
  if (Array.isArray(file?.assignments)) {
    return file.assignments.flatMap((assignment) => {
      const variant = normalizeVariantName(assignment?.variant);
      const page = Number(assignment?.pageNumber);
      if (!variant || !Number.isInteger(page) || page < 1) return [];
      return [{
        file,
        index,
        episodeId: String(file.name ?? '').slice(0, 8),
        variant,
        page
      }];
    });
  }
  if (file?.variant && Number.isInteger(Number(file.pageNumber))) {
    const variant = normalizeVariantName(file.variant);
    if (!variant || Number(file.pageNumber) < 1) return [];
    return [{
      file,
      index,
      episodeId: String(file.name ?? '').slice(0, 8),
      variant,
      page: Number(file.pageNumber)
    }];
  }
  const match = String(file?.name ?? '').match(SOURCE_IMAGE_PATTERN);
  if (!match) return [];
  return [{
    file,
    index,
    episodeId: match[1],
    variant: match[2].toLowerCase(),
    page: Number(match[3])
  }];
}

export function createEpisodeReaderModel(episode) {
  const directEntries = (episode?.files ?? []).flatMap(parseReaderFileAssignments);
  const entries = [...directEntries];
  const specialVariants = [...new Set(directEntries
    .map((entry) => entry.variant)
    .filter(isSpecialVariantName))];

  for (const specialVariant of specialVariants) {
    const baseVariant = getBaseVariantName(specialVariant);
    const overriddenPages = new Set(directEntries
      .filter((entry) => entry.variant === specialVariant)
      .map((entry) => entry.page));
    for (const baseEntry of directEntries) {
      if (baseEntry.variant !== baseVariant || overriddenPages.has(baseEntry.page)) continue;
      entries.push({
        ...baseEntry,
        variant: specialVariant,
        inherited: true,
        inheritedFrom: baseVariant
      });
    }
  }

  entries.sort((left, right) => (
    compareVariantNames(left.variant, right.variant)
    || left.page - right.page
    || left.index - right.index
  ));

  const variants = new Map();
  for (const entry of entries) {
    if (!variants.has(entry.variant)) variants.set(entry.variant, []);
    variants.get(entry.variant).push(entry);
  }

  const variantNames = [...variants.keys()].sort(compareVariantNames);
  const knownVariants = new Set(variantNames);
  const peekRelations = {};
  for (const [sourceValue, targetValue] of Object.entries(episode?.peekRelations ?? {})) {
    const source = normalizeVariantName(sourceValue);
    if (!source || !knownVariants.has(source)) continue;
    if (targetValue === null) {
      peekRelations[source] = null;
      continue;
    }
    const target = normalizeVariantName(targetValue);
    if (target && target !== source && knownVariants.has(target)) peekRelations[source] = target;
  }
  return { entries, variants, variantNames, peekRelations };
}

export function findPageEntry(model, variant, page) {
  return model.variants.get(variant)?.find((entry) => entry.page === Number(page)) ?? null;
}

export function findNearestPageEntry(model, variant, page) {
  const pages = model.variants.get(variant) ?? [];
  if (pages.length === 0) return null;
  const target = Number(page);
  return pages.reduce((best, entry) => (
    Math.abs(entry.page - target) < Math.abs(best.page - target) ? entry : best
  ), pages[0]);
}

export function getNextVariant(model, variant) {
  const index = model.variantNames.indexOf(variant);
  return index >= 0 ? model.variantNames[index + 1] ?? null : null;
}

function getValidPeekTarget(model, sourceVariant, targetValue) {
  const target = normalizeVariantName(targetValue);
  return target && target !== sourceVariant && model?.variants?.has(target) ? target : null;
}

export function getPeekTargetVariant(model, variant, temporaryTarget = undefined) {
  const source = normalizeVariantName(variant);
  if (!source || !model?.variants?.has(source)) return null;
  if (temporaryTarget === null) return null;
  if (temporaryTarget !== undefined) {
    const temporary = getValidPeekTarget(model, source, temporaryTarget);
    if (temporary) return temporary;
  }
  if (Object.hasOwn(model.peekRelations ?? {}, source)) {
    const configuredTarget = model.peekRelations[source];
    if (configuredTarget === null) return null;
    const persisted = getValidPeekTarget(model, source, configuredTarget);
    if (persisted) return persisted;
  }
  return getNextVariant(model, source);
}

export function resolvePeekTarget(model, variant, page, temporaryTarget = undefined) {
  const targetVariant = getPeekTargetVariant(model, variant, temporaryTarget);
  return {
    variant: targetVariant,
    entry: targetVariant ? findPageEntry(model, targetVariant, page) : null
  };
}

export function getAdjacentEntry(model, variant, page, direction) {
  const pages = model.variants.get(variant) ?? [];
  const index = pages.findIndex((entry) => entry.page === Number(page));
  if (index < 0) return null;
  return pages[index + Math.sign(direction)] ?? null;
}

export function getImageUrl(episodeId, index, identity = null) {
  const resolved = assetUrlResolver?.('image', episodeId, Number(index));
  if (resolved) return resolved;
  const key = identity == null ? '' : `&file=${encodeURIComponent(String(identity))}`;
  return `/api/image?episodeId=${encodeURIComponent(episodeId)}&index=${Number(index)}${key}`;
}

export function getThumbnailUrl(episodeId, index, identity = null) {
  const resolved = assetUrlResolver?.('thumbnail', episodeId, Number(index), identity);
  if (resolved) return resolved;
  const key = identity == null ? '' : `&file=${encodeURIComponent(String(identity))}`;
  return `/api/thumbnail?episodeId=${encodeURIComponent(episodeId)}&index=${Number(index)}${key}`;
}

export function getWheelIntent(event) {
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  return {
    mode: event.ctrlKey || event.metaKey ? 'zoom' : 'page',
    delta
  };
}

export function getPageSideDirection(viewportRect, planeRect, clientX) {
  if (!Number.isFinite(clientX) || !viewportRect || !planeRect) return 0;
  if (planeRect.left > viewportRect.left + 1 && clientX < planeRect.left) return -1;
  if (planeRect.right < viewportRect.right - 1 && clientX > planeRect.right) return 1;
  return 0;
}

export function getSequencePosition(sequence, episodeId) {
  const episodes = Array.isArray(sequence) ? sequence : [];
  const index = episodes.indexOf(episodeId);
  return { index, current: index >= 0 ? index + 1 : 0, total: episodes.length };
}
