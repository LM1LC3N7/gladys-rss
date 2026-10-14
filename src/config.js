// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized, and
// the grammar of the `feeds` field.
// -----------------------------------------------------------------------------

import { LIMITS, MAX_FEEDS, MAX_KEYWORDS } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  feeds: '',
  interval: 15,
  max_items: 10,
  keywords: '',
};
export const BOUNDS = { interval: [5, 1440], max_items: [1, 50] };

const number = (value, fallback, [min, max]) => {
  const n = Number(value);
  return value !== '' && value !== null && Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n)))
    : fallback;
};

/**
 * One entry of the `feeds` field: a URL, then an optional custom name after
 * a space or a `|`:
 *   "https://www.lemonde.fr/rss/une.xml Le Monde"
 *   "https://example.org/feed.xml|My blog"
 * Only http: and https: URLs are accepted (a `file:`, `ftp:` or `javascript:`
 * entry is refused, never fetched).
 *   -> { url, name } or { invalid: true }
 */
export function parseFeedEntry(entry) {
  const text = String(entry ?? '').trim();
  if (!text) {
    return undefined;
  }
  const cut = text.search(/[\s|]/);
  const address = cut === -1 ? text : text.slice(0, cut);
  const name =
    cut === -1
      ? ''
      : text
          .slice(cut + 1)
          .replace(/^[\s|]+/, '')
          .trim();
  let url;
  try {
    url = new URL(address);
  } catch {
    return { invalid: true };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { invalid: true };
  }
  url.hash = '';
  return { url: url.href, name: name.slice(0, LIMITS.NAME) || undefined };
}

/** The `feeds` field: entries separated by commas or new lines. */
export function parseFeeds(text) {
  const feeds = [];
  const invalid = [];
  const seen = new Set();
  String(text ?? '')
    .split(/[,\n\r]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry, index) => {
      const parsed = parseFeedEntry(entry);
      if (parsed.invalid) {
        // The position only: the entry itself may carry a token.
        invalid.push(index + 1);
      } else if (!seen.has(parsed.url) && feeds.length < MAX_FEEDS) {
        seen.add(parsed.url);
        feeds.push(parsed);
      }
    });
  return { feeds, invalid };
}

export function normalizeConfig(raw = {}) {
  const { feeds, invalid } = parseFeeds(raw.feeds);
  return {
    feeds,
    /** Positions (1-based) of the entries that are not http(s) URLs. */
    invalid,
    /** Minutes between two readings of a feed. */
    interval: number(raw.interval, DEFAULTS.interval, BOUNDS.interval),
    maxItems: number(raw.max_items, DEFAULTS.max_items, BOUNDS.max_items),
    /** As typed: the `keyword` of an event is one of them, spelled the same. */
    keywords: [
      ...new Set(
        String(raw.keywords ?? '')
          .split(/[,\n\r]+/)
          .map((k) => k.trim().slice(0, LIMITS.NAME))
          .filter(Boolean),
      ),
    ].slice(0, MAX_KEYWORDS),
  };
}
