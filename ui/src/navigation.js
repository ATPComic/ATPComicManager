export function currentAppPath(location = window.location) {
  return `${location.pathname}${location.search}${location.hash}`;
}

export function withReturnTo(path, returnTo = currentAppPath()) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('returnTo', returnTo);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function navigateToPage(path) {
  const returnTo = currentAppPath();
  window.location.assign(returnTo === '/' ? path : withReturnTo(path, returnTo));
}

export function libraryEpisodePath(episodeId) {
  return episodeId ? `/?focus=${encodeURIComponent(episodeId)}` : '/';
}

export function variantEpisodePath(episodeId) {
  const params = new URLSearchParams({ episode: episodeId, returnTo: libraryEpisodePath(episodeId) });
  return `/variants.html?${params}`;
}

export function returnPathFromHref(href, fallback = '/') {
  const returnTo = new URL(href, 'http://app.local').searchParams.get('returnTo');
  return returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : fallback;
}

export function returnFromPage(fallback = '/') {
  const returnTo = returnPathFromHref(window.location.href, null);
  if (returnTo) {
    window.location.assign(returnTo);
    return;
  }
  try {
    if (document.referrer && new URL(document.referrer).origin === window.location.origin && window.history.length > 1) {
      window.history.back();
      return;
    }
  } catch {
    // Fall through to the stable application root.
  }
  window.location.assign(fallback);
}
