// -----------------------------------------------------------------------------
// Two readings of a feed -> "new article" scene events. Pure.
//
// A feed has no "since" cursor: an article is new when its id (guid, Atom id,
// rdf:about, else its link) was not in any previous reading. The ids live in
// memory only (read-only rootfs), so after a restart the first reading of a
// feed fires nothing: it only learns what is already there.
// -----------------------------------------------------------------------------

import { LIMITS, MAX_EVENTS_PER_FEED, SCENE_TRIGGERS, SEEN_LIMIT } from './constants.js';
import { fold, truncate } from './text.js';

/**
 * The articles of `kept` (the window the user sees, newest first) that are
 * not in `seen`, at most MAX_EVENTS_PER_FEED (the newest ones), oldest first
 * so the scenes run in publication order. No `seen` (first reading): none.
 */
export function newArticles(seen, kept) {
  if (!seen) {
    return [];
  }
  return kept
    .filter((item) => !seen.has(item.id))
    .slice(0, MAX_EVENTS_PER_FEED)
    .reverse();
}

/**
 * Remember the ids of a reading (every parsed item, not only the kept ones:
 * an old article moving into the window is not new). The set keeps its
 * insertion order; the oldest ids go beyond SEEN_LIMIT.
 */
export function remember(seen, items, limit = SEEN_LIMIT) {
  const next = new Set(seen ?? []);
  for (const item of items) {
    next.delete(item.id); // re-inserted: the ids still in the feed stay young
    next.add(item.id);
  }
  const extra = next.size - limit;
  if (extra > 0) {
    let i = 0;
    for (const id of next) {
      if (i++ >= extra) break;
      next.delete(id);
    }
  }
  return next;
}

/**
 * The first keyword of the configuration found in the title (case and
 * accents ignored), as the user typed it: the scene trigger compares it with
 * equality, so it must be spelled like in the configuration.
 */
export function matchKeyword(title, keywords) {
  const text = fold(title);
  return keywords.find((k) => text.includes(fold(k))) ?? null;
}

/** The `new_article` event of an article. Every string fits the 1000 limit. */
export function articleEvent(feedName, item, keywords = []) {
  return {
    key: SCENE_TRIGGERS.NEW_ARTICLE,
    data: {
      feed: truncate(feedName, LIMITS.NAME),
      keyword: matchKeyword(item.title, keywords),
      title: truncate(item.title, LIMITS.TITLE),
      link: item.link && item.link.length <= LIMITS.LINK ? item.link : null,
      summary: truncate(item.summary ?? '', LIMITS.SUMMARY) || null,
      published: item.published ?? null,
    },
  };
}
