import { getPageFile } from './metadata.js';

function compareVariantNames(left, right) {
  const leftMatch = String(left).match(/^([a-z])(?:_sp([1-9]\d*))?$/i);
  const rightMatch = String(right).match(/^([a-z])(?:_sp([1-9]\d*))?$/i);
  if (!leftMatch || !rightMatch) return String(left).localeCompare(String(right));
  const baseComparison = leftMatch[1].localeCompare(rightMatch[1]);
  if (baseComparison) return baseComparison;
  return (leftMatch[2] == null ? -1 : Number(leftMatch[2]))
    - (rightMatch[2] == null ? -1 : Number(rightMatch[2]));
}

function getVariantNames(episode) {
  return Object.keys(episode?.variants ?? {}).sort(compareVariantNames);
}

function getVariantIndex(episode, variantName) {
  return getVariantNames(episode).indexOf(variantName);
}

export function cycleVariant(episode, currentVariant, currentPage) {
  const variantNames = getVariantNames(episode);
  if (variantNames.length === 0) {
    return null;
  }

  const currentIndex = Math.max(0, getVariantIndex(episode, currentVariant));
  const nextVariant = variantNames[(currentIndex + 1) % variantNames.length];
  const nextEntries = episode.variants?.[nextVariant] ?? [];
  if (nextEntries.length === 0) {
    return { variant: nextVariant, page: null, file: null };
  }

  const exactMatch = nextEntries.find((entry) => entry.page === currentPage);
  if (exactMatch) {
    return { variant: nextVariant, page: exactMatch.page, file: exactMatch.file };
  }

  const lastEntry = nextEntries.at(-1);
  return {
    variant: nextVariant,
    page: lastEntry.page,
    file: lastEntry.file
  };
}

export function getVariantPageFile(episode, variantName, pageNumber) {
  return getPageFile(episode?.variants?.[variantName], pageNumber);
}

// Peek deliberately differs from cycleVariant: it never wraps and requires
// the exact same page to exist in the immediately following variant.
export function getNextVariantPage(episode, currentVariant, currentPage) {
  const variantNames = getVariantNames(episode);
  const currentIndex = getVariantIndex(episode, currentVariant);
  if (currentIndex < 0) {
    return null;
  }

  const relations = episode?.peekRelations ?? {};
  const hasConfiguredTarget = Object.hasOwn(relations, currentVariant);
  const configuredVariant = relations[currentVariant];
  if (hasConfiguredTarget && configuredVariant === null) return null;
  const nextVariant = hasConfiguredTarget
    && configuredVariant !== currentVariant
    && variantNames.includes(configuredVariant)
    ? configuredVariant
    : variantNames[currentIndex + 1];
  if (!nextVariant) return null;
  const entry = (episode.variants?.[nextVariant] ?? [])
    .find((candidate) => Number(candidate.page) === Number(currentPage));
  return entry
    ? { variant: nextVariant, page: entry.page, file: entry.file }
    : null;
}
