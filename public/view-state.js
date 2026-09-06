export function readInitialViewState(search = '') {
  const params = new URLSearchParams(search);
  return {
    selectedEpisodeId: params.get('episode'),
    focusedEpisodeId: params.get('focus'),
    // A deep-linked preview is not a search request. Keep both states separate.
    searchText: ''
  };
}

export function getPreviewUrl(currentHref, episodeId) {
  const url = new URL(currentHref);
  if (episodeId) {
    url.searchParams.set('episode', episodeId);
  } else {
    url.searchParams.delete('episode');
  }
  return url.toString();
}
