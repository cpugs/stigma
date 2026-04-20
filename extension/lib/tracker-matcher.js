/**
 * Extract the hostname from a URL string.
 * Returns null for invalid URLs.
 */
export function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Look up a domain in the tracker database.
 * Returns tracker info with domain attached, or null if not found.
 */
export function lookupTracker(domain, trackers) {
  const entry = trackers[domain];
  if (!entry) return null;
  return { domain, ...entry };
}

/**
 * Deduplicate tracker matches by company+product.
 * Collects all matched domains into a `domains` array and
 * merges dataTypes across duplicates.
 */
export function aggregateTrackers(matches) {
  const map = new Map();
  for (const match of matches) {
    const key = `${match.company}::${match.product}`;
    if (map.has(key)) {
      const existing = map.get(key);
      if (match.domain && !existing.domains.includes(match.domain)) {
        existing.domains.push(match.domain);
      }
      const merged = new Set([...existing.dataTypes, ...match.dataTypes]);
      existing.dataTypes = [...merged];
    } else {
      const { domain, ...rest } = match;
      map.set(key, {
        ...rest,
        domains: domain ? [domain] : [],
        dataTypes: [...match.dataTypes],
      });
    }
  }
  return [...map.values()];
}

/**
 * Get badge background color based on tracker count.
 * Blue (0-3), Green (4-8), Yellow (9-15), Red (16+)
 */
export function getBadgeColor(count) {
  if (count <= 3) return '#2196F3';
  if (count <= 8) return '#4CAF50';
  if (count <= 15) return '#FF9800';
  return '#F44336';
}

/**
 * Get badge text. Empty string for 0 (hides badge).
 */
export function getBadgeCount(count) {
  return count === 0 ? '' : String(count);
}
