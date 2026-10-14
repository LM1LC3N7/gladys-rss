// -----------------------------------------------------------------------------
// The "news" dashboard widget: the latest articles of one feed or of all of
// them, newest first, as a card list (title, source, age, summary and link in
// the detail panel). Pure: `now` and the feed readings are parameters.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { T } from './i18n.js';
import { truncate } from './text.js';

export const WIDGET_TTL = 300;
export const MAX_CARDS = 8; // the card-list `list` display holds 8 rows
export const DEFAULT_CARDS = 5;

const pick = (text, language) => (typeof text === 'string' ? text : (text[language] ?? text.en));
const time = (iso) => (iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY);

/** The widget only takes https links: an http article link is upgraded. */
export function httpsLink(link) {
  if (!link) {
    return null;
  }
  const https = link.replace(/^http:\/\//i, 'https://');
  return /^https:\/\//i.test(https) && https.length <= 2048 ? https : null;
}

/** The `count` setting, bounded to what a card list shows. */
export function cardCount(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_CARDS, n) : DEFAULT_CARDS;
}

/**
 * `feeds`: the selected feeds, each { name, readAt, error, items } where
 * `items` is the kept window (newest first). `title` heads the card.
 */
export function newsWidget({ title, feeds, count, now, language = 'en' }) {
  const components = [
    { type: 'text', text: truncate(pick(title, language), 40), variant: 'heading' },
  ];
  const read = feeds.filter((f) => f.readAt);
  if (read.length === 0) {
    const failing = feeds.filter((f) => f.error).length;
    components.push({
      type: 'text',
      text: failing ? T.widget.failing(failing) : T.widget.notLoaded,
      variant: 'body',
    });
    return { ttl_seconds: 60, components };
  }
  const articles = feeds
    .flatMap((f) => f.items.map((item, index) => ({ item, index, source: f.name })))
    // Newest first across feeds; an undated article keeps its feed's order.
    .sort((a, b) => time(b.item.published) - time(a.item.published) || a.index - b.index)
    .slice(0, cardCount(count));
  if (articles.length === 0) {
    // Two texts at most per card: the heading and this one.
    components.push({ type: 'text', text: T.widget.empty, variant: 'body' });
    return { ttl_seconds: WIDGET_TTL, components };
  }
  const items = articles.map(({ item, source }) => {
    const link = httpsLink(item.link);
    const card = { title: truncate(item.title, 60), subtitle: truncate(source, 60) };
    if (item.published) {
      const age = now - Date.parse(item.published);
      card.date = item.published;
      card.badge = {
        text: pick(T.age(age), language),
        color: age < 60 * 60_000 ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
      };
    }
    if (item.summary) {
      card.description = item.summary;
    }
    if (link) {
      card.links = [{ url: link, label: T.widget.read }];
    }
    return card;
  });
  components.push({ type: 'card-list', display: 'list', items });
  const failing = feeds.filter((f) => f.error).length;
  const lastRead = Math.max(...read.map((f) => Date.parse(f.readAt)));
  components.push({
    type: 'text',
    text: failing ? T.widget.failing(failing) : T.widget.updated(T.ago(now - lastRead)),
    variant: 'caption',
  });
  return { ttl_seconds: WIDGET_TTL, components };
}

/** A widget that only says something (no feed configured, unknown feed). */
export function messageWidget(title, message, language = 'en') {
  return {
    ttl_seconds: WIDGET_TTL,
    components: [
      { type: 'text', text: truncate(pick(title, language), 40), variant: 'heading' },
      { type: 'text', text: message, variant: 'body' },
    ],
  };
}
