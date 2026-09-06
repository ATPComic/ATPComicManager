import { getEpisode, nextEpisode as getNextEpisode, previousEpisode as getPreviousEpisode } from './metadata.js';

export function nextEpisode(themeIndex, episodeId) {
  return getNextEpisode(themeIndex, episodeId);
}

export function previousEpisode(themeIndex, episodeId) {
  return getPreviousEpisode(themeIndex, episodeId);
}

export function continueReading(themeIndex, episodeId, variantName, pageNumber) {
  const episode = getEpisode(themeIndex, episodeId);
  if (!episode) {
    return null;
  }

  const entries = episode.variants?.[variantName] ?? [];
  const currentIndex = entries.findIndex((entry) => entry.page === pageNumber);
  if (currentIndex >= 0 && currentIndex < entries.length - 1) {
    return {
      episode,
      variant: variantName,
      page: entries[currentIndex + 1].page,
      file: entries[currentIndex + 1].file
    };
  }

  const next = getNextEpisode(themeIndex, episodeId);
  if (!next) {
    return null;
  }

  const nextVariant = Object.keys(next.variants ?? {}).sort((left, right) => left.localeCompare(right))[0];
  const firstEntry = nextVariant ? next.variants[nextVariant]?.[0] : null;
  if (!firstEntry) {
    return null;
  }

  return {
    episode: next,
    variant: nextVariant,
    page: firstEntry.page,
    file: firstEntry.file
  };
}

export function previousReading(themeIndex, episodeId, variantName, pageNumber) {
  const episode = getEpisode(themeIndex, episodeId);
  if (!episode) {
    return null;
  }

  const entries = episode.variants?.[variantName] ?? [];
  const currentIndex = entries.findIndex((entry) => entry.page === pageNumber);
  if (currentIndex > 0) {
    return {
      episode,
      variant: variantName,
      page: entries[currentIndex - 1].page,
      file: entries[currentIndex - 1].file
    };
  }

  const previous = getPreviousEpisode(themeIndex, episodeId);
  if (!previous) {
    return null;
  }

  const previousVariantNames = Object.keys(previous.variants ?? {}).sort((left, right) => left.localeCompare(right));
  const previousVariant = previousVariantNames.at(-1) ?? null;
  if (!previousVariant) {
    return null;
  }

  const previousEntries = previous.variants[previousVariant] ?? [];
  const lastEntry = previousEntries.at(-1);
  if (!lastEntry) {
    return null;
  }

  return {
    episode: previous,
    variant: previousVariant,
    page: lastEntry.page,
    file: lastEntry.file
  };
}