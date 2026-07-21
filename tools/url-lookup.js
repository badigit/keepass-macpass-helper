/* KeePass Helper — exact-first URL lookup with a conservative domain fallback.
 *
 * The fallback is intentionally opt-in at each call site.  It must only be
 * used for user-visible credential selection (hints/popup), never for
 * automatic login, saving, or updating entries. */
(function (root, factory) {
  const api = factory(
    root && root.tldjs || (typeof require === 'function' ? require('./tld.js') : null)
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  else {
    root.__kpUrlLookup = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function (tldApi) {
  const lookupUrlCandidates = href => {
    const candidates = [href];
    let url;
    try {
      url = new URL(href);
    }
    catch {
      return candidates;
    }

    if (!['http:', 'https:'].includes(url.protocol) || !tldApi) {
      return candidates;
    }

    const domain = tldApi.getDomain(url.hostname);
    if (!domain) {
      return candidates;
    }

    for (const candidate of [
      `${url.protocol}//www.${domain}/`,
      `${url.protocol}//${domain}/`
    ]) {
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
    return candidates;
  };

  const entryKey = entry => {
    const id = entry.Uuid || entry.UUID || entry.uuid;
    if (id) {
      return `id:${id}`;
    }
    return JSON.stringify([
      entry.Login || '',
      entry.Name || '',
      entry.group || '',
      entry.Password || '',
      entry.StringFields || []
    ]);
  };

  const taggedEntries = (entries, lookupUrl, seen) => {
    const tagged = [];
    entries.forEach((entry, lookupIndex) => {
      const key = entryKey(entry);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      tagged.push({
        ...entry,
        __kpLookup: {
          url: lookupUrl,
          index: lookupIndex
        }
      });
    });
    return tagged;
  };

  const searchWithUrlFallback = async (search, href) => {
    const candidates = lookupUrlCandidates(href);
    const exact = await search(candidates[0]);
    const exactEntries = exact?.Entries || [];
    const seen = new Set();

    if (exactEntries.length) {
      return {
        ...exact,
        Entries: taggedEntries(exactEntries, candidates[0], seen)
      };
    }

    const entries = [];
    for (const candidate of candidates.slice(1)) {
      const response = await search(candidate);
      entries.push(...taggedEntries(response?.Entries || [], candidate, seen));
    }
    return {
      ...exact,
      Entries: entries
    };
  };

  const isLookupCandidate = (href, candidate) =>
    lookupUrlCandidates(href).includes(candidate);

  return {
    lookupUrlCandidates,
    searchWithUrlFallback,
    isLookupCandidate
  };
});
