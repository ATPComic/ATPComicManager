export const DEFAULT_VARIANT_NAMES = ['a', 'b', 'c'];
export const VARIANT_NAMES = DEFAULT_VARIANT_NAMES;

export function isValidEpisodeId(value) {
  return typeof value === 'string' && (/^\d{8}$/.test(value) || /^folder:[^\u0000-\u001f]{1,505}$/.test(value));
}

export function createEmptyVariantAssignments() {
  return { version: 3, episodes: {}, peekRelations: {} };
}

export function normalizeVariantName(value) {
  const name = String(value ?? '').trim().toLowerCase();
  return /^[a-z](?:_sp[1-9]\d*)?$/.test(name) ? name : null;
}

export function compareVariantNames(left, right) {
  const leftMatch = String(left).match(/^([a-z])(?:_sp([1-9]\d*))?$/);
  const rightMatch = String(right).match(/^([a-z])(?:_sp([1-9]\d*))?$/);
  if (!leftMatch || !rightMatch) return String(left).localeCompare(String(right), 'en');
  const baseComparison = leftMatch[1].localeCompare(rightMatch[1], 'en');
  if (baseComparison) return baseComparison;
  const leftSpecial = leftMatch[2] == null ? -1 : Number(leftMatch[2]);
  const rightSpecial = rightMatch[2] == null ? -1 : Number(rightMatch[2]);
  return leftSpecial - rightSpecial;
}

export function getBaseVariantName(value) {
  return normalizeVariantName(value)?.match(/^([a-z])/)?.[1] ?? null;
}

export function isSpecialVariantName(value) {
  return /^[a-z]_sp[1-9]\d*$/.test(normalizeVariantName(value) ?? '');
}

export function normalizePeekRelations(input) {
  const result = {};
  for (const [sourceValue, targetValue] of Object.entries(input ?? {})) {
    const source = normalizeVariantName(sourceValue);
    if (!source) continue;
    if (targetValue === null) {
      result[source] = null;
      continue;
    }
    const target = normalizeVariantName(targetValue);
    if (target && source !== target) result[source] = target;
  }
  return result;
}

export function normalizeVariantToken(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return /^[a-z]?\d+(?:_[a-z0-9]+)*$/.test(token) ? token : null;
}

export function getEpisodeVariantNames(input, { includeDefaults = true } = {}) {
  const names = new Set(includeDefaults ? DEFAULT_VARIANT_NAMES : []);
  for (const value of Object.keys(input ?? {})) {
    const name = normalizeVariantName(value);
    if (name) names.add(name);
  }
  return [...names].sort(compareVariantNames);
}

export function normalizeEpisodeVariantAssignments(input) {
  const result = {};
  for (const variant of getEpisodeVariantNames(input)) {
    const seen = new Set();
    result[variant] = [];
    for (const value of input?.[variant] ?? []) {
      const token = normalizeVariantToken(value);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      result[variant].push(token);
    }
  }
  return result;
}

export function normalizeVariantAssignments(input) {
  const sourceVersion = Number(input?.version);
  const version = sourceVersion >= 4
    ? 4
    : sourceVersion >= 3
      ? 3
      : Object.keys(input?.episodes ?? {}).length
        ? 2
        : 3;
  const result = { version, episodes: {}, peekRelations: {} };
  for (const [episodeId, assignments] of Object.entries(input?.episodes ?? {})) {
    if (!isValidEpisodeId(episodeId)) continue;
    const normalized = normalizeEpisodeVariantAssignments(assignments);
    const hasCustomVariant = getEpisodeVariantNames(assignments, { includeDefaults: false })
      .some((variant) => !DEFAULT_VARIANT_NAMES.includes(variant));
    const hasAssignment = Object.values(normalized).some((tokens) => tokens.length);
    if (version >= 3 || hasAssignment || hasCustomVariant) result.episodes[episodeId] = normalized;
  }
  for (const [episodeId, relations] of Object.entries(input?.peekRelations ?? {})) {
    if (!isValidEpisodeId(episodeId)) continue;
    const normalized = normalizePeekRelations(relations);
    if (Object.keys(normalized).length) result.peekRelations[episodeId] = normalized;
  }
  for (const [episodeId, mappings] of Object.entries(input?.pageMappings ?? {})) {
    if (!isValidEpisodeId(episodeId)) continue;
    const episodeAssignments = result.episodes[episodeId];
    if (!episodeAssignments) continue;
    const normalizedMappings = {};
    for (const [variantValue, tokenMappings] of Object.entries(mappings ?? {})) {
      const variant = normalizeVariantName(variantValue);
      if (!variant || !Object.hasOwn(episodeAssignments, variant)) continue;
      const assignedTokens = new Set(episodeAssignments[variant]);
      const variantMappings = {};
      for (const [tokenValue, pageValue] of Object.entries(tokenMappings ?? {})) {
        const token = normalizeVariantToken(tokenValue);
        const pageNumber = Number(pageValue);
        if (token && assignedTokens.has(token) && Number.isInteger(pageNumber) && pageNumber > 0) {
          variantMappings[token] = pageNumber;
        }
      }
      if (Object.keys(variantMappings).length) normalizedMappings[variant] = variantMappings;
    }
    if (Object.keys(normalizedMappings).length) {
      if (!result.pageMappings) result.pageMappings = {};
      result.pageMappings[episodeId] = normalizedMappings;
    }
  }
  if (Object.keys(result.pageMappings ?? {}).length && result.version < 4) result.version = 4;
  return result;
}

export function getVariantPageMapping(input, episodeId, variantValue, tokenValue) {
  const variant = normalizeVariantName(variantValue);
  const token = normalizeVariantToken(tokenValue);
  if (!variant || !token) return null;
  const pageNumber = Number(input?.pageMappings?.[episodeId]?.[variant]?.[token]);
  return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null;
}

export function setVariantPageMapping(input, episodeId, variantValue, tokenValue, pageValue = null) {
  const result = normalizeVariantAssignments(input);
  const variant = normalizeVariantName(variantValue);
  const token = normalizeVariantToken(tokenValue);
  if (!isValidEpisodeId(episodeId) || !variant || !token || !result.episodes[episodeId]?.[variant]?.includes(token)) {
    return result;
  }
  const pageNumber = Number(pageValue);
  const pageMappings = { ...(result.pageMappings ?? {}) };
  const episodeMappings = { ...(pageMappings[episodeId] ?? {}) };
  const variantMappings = { ...(episodeMappings[variant] ?? {}) };
  if (Number.isInteger(pageNumber) && pageNumber > 0) variantMappings[token] = pageNumber;
  else delete variantMappings[token];
  if (Object.keys(variantMappings).length) episodeMappings[variant] = variantMappings;
  else delete episodeMappings[variant];
  if (Object.keys(episodeMappings).length) pageMappings[episodeId] = episodeMappings;
  else delete pageMappings[episodeId];
  if (Object.keys(pageMappings).length) {
    result.pageMappings = pageMappings;
    result.version = 4;
  } else {
    delete result.pageMappings;
    if (result.version === 4) result.version = 3;
  }
  return result;
}

export function createVariantAssignmentDraft(input, library) {
  const source = normalizeVariantAssignments(input);
  const result = createEmptyVariantAssignments();
  for (const [episodeId, episode] of Object.entries(library?.episodes ?? {})) {
    if (!isValidEpisodeId(episodeId)) continue;
    const existing = normalizeEpisodeVariantAssignments(source.episodes[episodeId]);
    const variants = new Set(getEpisodeVariantNames(existing));
    const entries = [];
    for (const [fileIndex, file] of (episode?.files ?? []).entries()) {
      const token = normalizeVariantToken(file?.assignmentToken);
      if (!token) continue;
      for (const [assignmentIndex, assignment] of (file?.assignments ?? []).entries()) {
        const variant = normalizeVariantName(assignment?.variant);
        const pageNumber = Number(assignment?.pageNumber);
        if (!variant || !Number.isInteger(pageNumber) || pageNumber < 1) continue;
        variants.add(variant);
        entries.push({ token, variant, pageNumber, fileIndex, assignmentIndex });
      }
    }
    const draft = Object.fromEntries([...variants].sort(compareVariantNames).map((variant) => [variant, []]));
    entries.sort((left, right) => (
      compareVariantNames(left.variant, right.variant)
      || left.pageNumber - right.pageNumber
      || left.fileIndex - right.fileIndex
      || left.assignmentIndex - right.assignmentIndex
    ));
    for (const entry of entries) {
      if (!draft[entry.variant].includes(entry.token)) draft[entry.variant].push(entry.token);
    }
    result.episodes[episodeId] = draft;
    const nonEmptyVariants = new Set(Object.entries(draft)
      .filter(([, tokens]) => tokens.length)
      .map(([variant]) => variant));
    const relations = Object.fromEntries(Object.entries(normalizePeekRelations(source.peekRelations[episodeId]))
      .filter(([relationSource, target]) => (
        nonEmptyVariants.has(relationSource)
        && (target === null || nonEmptyVariants.has(target))
      )));
    if (Object.keys(relations).length) result.peekRelations[episodeId] = relations;
    const mappings = source.pageMappings?.[episodeId] ?? {};
    for (const [variant, tokenMappings] of Object.entries(mappings)) {
      if (!draft[variant]) continue;
      for (const [token, pageNumber] of Object.entries(tokenMappings)) {
        if (!draft[variant].includes(token)) continue;
        if (!result.pageMappings) result.pageMappings = {};
        if (!result.pageMappings[episodeId]) result.pageMappings[episodeId] = {};
        if (!result.pageMappings[episodeId][variant]) result.pageMappings[episodeId][variant] = {};
        result.pageMappings[episodeId][variant][token] = pageNumber;
        result.version = 4;
      }
    }
  }
  return result;
}

export function findVariantAssignments(assignments, token) {
  const normalizedToken = normalizeVariantToken(token);
  if (!normalizedToken) return [];
  const matches = [];
  for (const variant of getEpisodeVariantNames(assignments)) {
    const index = assignments?.[variant]?.indexOf(normalizedToken) ?? -1;
    if (index >= 0) matches.push({ variant, index });
  }
  return matches;
}

export function findVariantAssignment(assignments, token) {
  return findVariantAssignments(assignments, token)[0] ?? null;
}

export function addVariant(assignments, variant) {
  const name = normalizeVariantName(variant);
  const next = normalizeEpisodeVariantAssignments(assignments);
  if (name && !Object.hasOwn(next, name)) next[name] = [];
  return Object.fromEntries(Object.entries(next).sort(([left], [right]) => compareVariantNames(left, right)));
}

export function removeVariant(assignments, variant) {
  const name = normalizeVariantName(variant);
  const next = normalizeEpisodeVariantAssignments(assignments);
  if (!name || DEFAULT_VARIANT_NAMES.includes(name) || (next[name]?.length ?? 0) > 0) return next;
  delete next[name];
  return Object.fromEntries(Object.entries(next).sort(([left], [right]) => compareVariantNames(left, right)));
}

export function assignVariantToken(assignments, token, targetVariant, targetIndex) {
  const normalizedToken = normalizeVariantToken(token);
  const variant = normalizeVariantName(targetVariant);
  const next = addVariant(assignments, variant);
  if (!normalizedToken || !variant) return next;
  next[variant] = next[variant].filter((value) => value !== normalizedToken);
  const index = Math.max(0, Math.min(next[variant].length, Math.round(Number(targetIndex) || 0)));
  next[variant].splice(index, 0, normalizedToken);
  return next;
}

export function removeVariantToken(assignments, token, sourceVariant) {
  const normalizedToken = normalizeVariantToken(token);
  const variant = normalizeVariantName(sourceVariant);
  const next = normalizeEpisodeVariantAssignments(assignments);
  if (normalizedToken && variant && next[variant]) {
    next[variant] = next[variant].filter((value) => value !== normalizedToken);
  }
  return next;
}

// Backward-compatible move helper. New UI flows use assignVariantToken so a
// cross-column drop copies the source; callers can pass sourceVariant to move.
export function moveVariantToken(assignments, token, targetVariant, targetIndex, sourceVariant = null) {
  let next = assignVariantToken(assignments, token, targetVariant, targetIndex);
  const source = normalizeVariantName(sourceVariant);
  const target = normalizeVariantName(targetVariant);
  if (source && source !== target) next = removeVariantToken(next, token, source);
  return next;
}
