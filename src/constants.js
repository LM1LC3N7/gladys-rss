// -----------------------------------------------------------------------------
// Constants of the RSS and Atom integration.
// -----------------------------------------------------------------------------

/** Every request says who reads the feed, so a publisher can reach us. */
export const USER_AGENT = 'gladys-rss/0.1 (+https://github.com/LM1LC3N7/gladys-rss)';
export const ACCEPT =
  'application/rss+xml, application/atom+xml, application/rdf+xml;q=0.9, ' +
  'application/xml;q=0.8, text/xml;q=0.8, */*;q=0.5';

/** One feed request, redirects and body included. */
export const HTTP_TIMEOUT = 15_000;
/** A feed bigger than this (decompressed) is abandoned while streaming. */
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

/** The loop looks for due feeds every minute; it only calls a feed when due. */
export const TICK = 60_000;
/**
 * A Cache-Control max-age, an RSS ttl or a Retry-After is honoured up to
 * this. Many servers send one site-wide max-age (a day on debian.org): with
 * conditional GET a reading every few hours stays cheap for them.
 */
export const MAX_DELAY = 6 * 60 * 60_000;
/** A failing feed is retried less and less often, up to this. */
export const MAX_BACKOFF = 4 * 60 * 60_000;
/** The "Test the feeds" button stops starting new reads after this. */
export const TEST_DEADLINE = 90_000;

export const MAX_FEEDS = 30;
export const MAX_KEYWORDS = 20;
/** Items parsed per feed (a feed listing hundreds keeps its newest ones). */
export const MAX_PARSED_ITEMS = 200;
/** Ids remembered per feed to tell a new article from a known one. */
export const SEEN_LIMIT = 1000;
/** At most this many "new article" events per feed and per reading. */
export const MAX_EVENTS_PER_FEED = 5;

/** Bounds of every text before it reaches Gladys. */
export const LIMITS = { TITLE: 300, SUMMARY: 1000, NAME: 100, LINK: 1000, ID: 500 };

/** Manifest keys (forever: stored in user scenes and dashboards). */
export const ACTIONS = { TEST: 'test_feeds' };
export const SCENE_TRIGGERS = { NEW_ARTICLE: 'new_article' };
export const SCENE_ACTIONS = { LATEST: 'get_latest_article' };
export const WIDGETS = { NEWS: 'news' };

/** What the `new_article` events and the `get_latest_article` outputs carry. */
export const EVENT_KEYS = ['feed', 'keyword', 'title', 'link', 'summary', 'published'];
export const OUTPUT_KEYS = ['feed', 'title', 'link', 'summary', 'published', 'count'];
