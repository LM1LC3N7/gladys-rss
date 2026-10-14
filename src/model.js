// -----------------------------------------------------------------------------
// A feed document -> { format, title, link, ttlMinutes, items } (pure).
// RSS 0.9x/2.0, RSS 1.0 (RDF) and Atom 1.0 (and 0.3) land in the same shape:
//   item = { id, title, link, summary, published }
// Every text is stripped of its HTML and bounded (LIMITS), every link is
// resolved against the feed URL (and xml:base) and kept only in http(s).
// -----------------------------------------------------------------------------

import { LIMITS, MAX_PARSED_ITEMS } from './constants.js';
import { htmlToText, plainText } from './text.js';
import { NS, attrOf, childOf, childrenOf, parseXml, textOf } from './xml.js';

export class FeedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FeedError';
    this.code = code;
  }
}

// RSS 2.0 elements have no namespace; RSS 1.0 and 0.90 put theirs in one.
const RSS = ['', NS.RSS1, NS.RSS09];
const ATOM = [NS.ATOM, NS.ATOM03];

// --- Dates --------------------------------------------------------------------

// Zone abbreviations Date.parse does not know (it knows UT, GMT and the US ones).
const ZONES = {
  CET: '+0100',
  CEST: '+0200',
  MET: '+0100',
  MEST: '+0200',
  BST: '+0100',
  WET: '+0000',
  WEST: '+0100',
  EET: '+0200',
  EEST: '+0300',
  MSK: '+0300',
  JST: '+0900',
  KST: '+0900',
  AEST: '+1000',
  AEDT: '+1100',
  NZST: '+1200',
  NZDT: '+1300',
};

/** An RFC 822 (RSS) or ISO 8601 (Atom, dc:date) date -> ISO string, or null. */
export function parseDate(text) {
  const raw = String(text ?? '')
    .trim()
    .slice(0, 80);
  // Date.parse accepts almost anything ("12" is December 2001): a date
  // needs a four-digit year or a month name to be trusted.
  if (!raw || !/\d{4}|[a-z]{3}/i.test(raw)) {
    return null;
  }
  let time = Date.parse(raw);
  if (Number.isNaN(time)) {
    const zone = /\s([A-Z]{3,4})$/.exec(raw);
    if (zone && Object.hasOwn(ZONES, zone[1])) {
      time = Date.parse(`${raw.slice(0, zone.index)} ${ZONES[zone[1]]}`);
    }
  }
  if (Number.isNaN(time)) {
    return null;
  }
  const year = new Date(time).getUTCFullYear();
  return year >= 1990 && year <= 2200 ? new Date(time).toISOString() : null;
}

// --- Links --------------------------------------------------------------------

/** Resolve `href` against `base`; null unless http(s) and reasonably short. */
export function resolveLink(href, base) {
  const raw = String(href ?? '').trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.href.length <= LIMITS.LINK ? url.href : null;
  } catch {
    return null;
  }
}

/** The base URL of an element: its xml:base resolved against its parent's. */
function baseOf(el, parentBase) {
  const declared = el?.attrs['xml:base'];
  if (!declared) {
    return parentBase;
  }
  try {
    return new URL(declared, parentBase).href;
  } catch {
    return parentBase;
  }
}

// --- Texts --------------------------------------------------------------------

const TITLE = { max: LIMITS.TITLE, singleLine: true };
const SUMMARY = { max: LIMITS.SUMMARY };
const NAME = { max: LIMITS.NAME, singleLine: true };

/** An Atom text construct: type="text" (default), "html" or "xhtml". */
function atomText(el, options) {
  if (!el) {
    return '';
  }
  const type = String(el.attrs.type ?? 'text').toLowerCase();
  if (type === 'xhtml' || type === 'application/xhtml+xml') {
    return plainText(textOf(el), options);
  }
  if (type === 'html' || type === 'text/html') {
    return htmlToText(textOf(el), options);
  }
  return plainText(textOf(el), options);
}

/** An RSS text: the format says plain text, feeds put HTML in it anyway. */
const rssText = (el, options) => htmlToText(textOf(el), options);

const firstText = (...values) => values.find((v) => v) ?? '';

/** The item a title-less entry still deserves: its summary, else its link. */
function finishItem(item) {
  if (!item.title) {
    item.title = item.summary ? plainText(item.summary, { ...TITLE, max: 100 }) : '';
  }
  if (!item.title && item.link) {
    item.title = plainText(item.link, TITLE);
  }
  const id = plainText(item.id, { max: LIMITS.ID, singleLine: true });
  item.id = id || item.link || `${item.title}|${item.published ?? ''}`;
  return item.title || item.summary || item.link ? item : undefined;
}

// --- Formats ------------------------------------------------------------------

function rssItem(el, base) {
  const itemBase = baseOf(el, base);
  const guid = childOf(el, RSS, 'guid');
  const guidText = plainText(textOf(guid), { singleLine: true });
  const permalink = guid && String(guid.attrs.isPermaLink ?? 'true').toLowerCase() !== 'false';
  const atomLink = childrenOf(el, [NS.ATOM], 'link').find(
    (l) => !l.attrs.rel || l.attrs.rel === 'alternate',
  );
  const media =
    childOf(el, [NS.MEDIA], 'description') ??
    childOf(
      childOf(el, [NS.MEDIA], 'group') ?? childOf(el, [NS.MEDIA], 'content'),
      [NS.MEDIA],
      'description',
    );
  const summary = firstText(
    rssText(childOf(el, RSS, 'description'), SUMMARY),
    rssText(childOf(el, [NS.CONTENT], 'encoded'), SUMMARY),
    rssText(media, SUMMARY),
  );
  return finishItem({
    id: guidText || attrOf(el, 'about') || '',
    title: rssText(childOf(el, RSS, 'title'), TITLE),
    link:
      resolveLink(textOf(childOf(el, RSS, 'link')), itemBase) ??
      resolveLink(atomLink?.attrs.href, itemBase) ??
      (permalink ? resolveLink(guidText, itemBase) : null),
    summary,
    published: parseDate(
      firstText(
        textOf(childOf(el, RSS, 'pubDate')),
        textOf(childOf(el, [NS.DC], 'date')),
        textOf(childOf(el, [NS.ATOM], 'updated')),
      ),
    ),
  });
}

/** The alternate link of an Atom element (rel absent or "alternate", HTML first). */
function atomLink(el, base) {
  const links = childrenOf(el, ATOM, 'link').filter(
    (l) => !l.attrs.rel || l.attrs.rel === 'alternate',
  );
  const best = links.find((l) => /html/i.test(l.attrs.type ?? 'text/html')) ?? links[0];
  return best ? resolveLink(best.attrs.href, baseOf(best, base)) : null;
}

function atomEntry(el, base) {
  const entryBase = baseOf(el, base);
  const id = plainText(textOf(childOf(el, ATOM, 'id')), { singleLine: true });
  const content = childOf(el, ATOM, 'content');
  return finishItem({
    id,
    title: atomText(childOf(el, ATOM, 'title'), TITLE),
    link: atomLink(el, entryBase) ?? (/^https?:\/\//i.test(id) ? resolveLink(id) : null),
    summary: firstText(
      atomText(childOf(el, ATOM, 'summary'), SUMMARY),
      // An out-of-line content (src) has no text to show.
      content?.attrs.src ? '' : atomText(content, SUMMARY),
    ),
    published: parseDate(
      firstText(
        textOf(childOf(el, ATOM, 'published')),
        textOf(childOf(el, ATOM, 'issued')),
        textOf(childOf(el, ATOM, 'updated')),
        textOf(childOf(el, ATOM, 'modified')),
        textOf(childOf(el, [NS.DC], 'date')),
      ),
    ),
  });
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

/**
 * Parse a feed document. `url` is the address it was read from (after the
 * redirects): relative links resolve against it.
 */
export function parseFeed(text, { url } = {}) {
  let root;
  try {
    root = parseXml(String(text ?? ''));
  } catch (err) {
    throw new FeedError('not_a_feed', `not an RSS or Atom feed (${err.message})`);
  }
  const base = baseOf(root, url);
  if (root.local === 'rss' && root.ns === '') {
    const channel = childOf(root, RSS, 'channel') ?? root;
    const channelBase = baseOf(channel, base);
    // Some feeds put the items next to the channel instead of inside it.
    const raw = [...childrenOf(channel, RSS, 'item'), ...childrenOf(root, RSS, 'item')];
    const ttl = Number.parseInt(textOf(childOf(channel, RSS, 'ttl')), 10);
    return {
      format: 'RSS',
      title: rssText(childOf(channel, RSS, 'title'), NAME),
      link: resolveLink(textOf(childOf(channel, RSS, 'link')), channelBase),
      ttlMinutes: Number.isFinite(ttl) && ttl > 0 ? ttl : null,
      items: uniqueItems(raw.slice(0, MAX_PARSED_ITEMS).map((el) => rssItem(el, channelBase))),
    };
  }
  if (root.local === 'RDF' && root.ns === NS.RDF) {
    const channel = childOf(root, RSS, 'channel');
    const raw = [...childrenOf(root, RSS, 'item'), ...childrenOf(channel, RSS, 'item')];
    return {
      format: 'RSS 1.0',
      title: rssText(childOf(channel, RSS, 'title'), NAME),
      link: resolveLink(textOf(childOf(channel, RSS, 'link')), base),
      ttlMinutes: null,
      items: uniqueItems(raw.slice(0, MAX_PARSED_ITEMS).map((el) => rssItem(el, base))),
    };
  }
  if (root.local === 'feed' && ATOM.includes(root.ns)) {
    return {
      format: 'Atom',
      title: atomText(childOf(root, ATOM, 'title'), NAME),
      link: atomLink(root, base),
      ttlMinutes: null,
      items: uniqueItems(
        childrenOf(root, ATOM, 'entry')
          .slice(0, MAX_PARSED_ITEMS)
          .map((el) => atomEntry(el, base)),
      ),
    };
  }
  throw new FeedError(
    'not_a_feed',
    `not an RSS or Atom feed (<${root.name.slice(0, 40)}> document)`,
  );
}

// --- Order --------------------------------------------------------------------

/**
 * Newest first. A feed where every item is dated is sorted by date (some
 * publishers list them in any order); otherwise the feed's own order, which
 * is newest first by convention, is the only one to trust.
 */
export function sortItems(items) {
  if (items.length === 0 || items.some((item) => !item.published)) {
    return [...items];
  }
  return [...items].sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
}
